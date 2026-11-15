import express, { Express, Router } from 'express';
import multer from 'multer';
import path from 'path';
import { createHash } from 'crypto';
import { prisma } from './db';
import { connectProducer, producer } from './utils/kafka';
import { uploadToS3, currentBucket, downloadFromS3 } from './utils/s3';
import { assertCompanyAccess, requireAuth, requireCompanyAccess } from './middleware/requireAuth';
import { processVoucher } from './processing';
import { startInboxWatcher } from './utils/inboxWatcher';
import { localBusEnabled } from './utils/localBus';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

type IncomingFile = { buffer: Buffer; mimetype: string; originalname: string; size: number };

/** Tallennus MinIOon + tositerivi + luku taustalla. Yhteinen latausrajapinnalle ja saapuneet-kansiolle. */
const createVoucher = async (companyId: string, file: IncomingFile, uploadedBy: string, voucherType?: string, voucherDate?: string) => {
  const s3Key = await uploadToS3(file);
  const voucher = await prisma.voucher.create({
    data: {
      companyId,
      voucherType: (voucherType as any) || 'PURCHASE',
      voucherDate: new Date(voucherDate || Date.now()),
      ocrStatus: 'PENDING',
      status: 'UNPROCESSED',
      uploadedBy,
      files: {
        create: {
          filename: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          s3Key: s3Key,
          s3Bucket: currentBucket(),
          checksum: createHash('sha256').update(file.buffer).digest('hex'), // eheyden todentaminen (KPL 2:10 §)
        }
      }
    },
    include: { files: true }
  });
  processVoucher(prisma, voucher.id, file).catch((err) => console.error(`Tositteen ${voucher.id} käsittely kaatui:`, err));
  return voucher;
};

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
};


// Voucher upload endpoint
router.post('/upload', requireAuth, upload.single('file'), requireCompanyAccess({ required: true }), async (req, res) => {
  try {
    const file = req.file;
    const { companyId, voucherType, voucherDate } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const voucher = await createVoucher(companyId, file, (req as any).user?.userId || 'system', voucherType, voucherDate);
    // Luku taustalla (tekoäly voi kestää kymmeniä sekunteja); tila näkyy GET /vouchers/:id
    res.json({
      message: 'Tosite ladattu, luku käynnissä',
      voucherId: voucher.id,
      s3Key: voucher.files[0].s3Key
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Yhtiön tositteet (Käsittelemättömät-näkymä näyttää luvun tilan ja virheet)
router.get('/', requireAuth, requireCompanyAccess({ required: true }), async (req, res) => {
  const vouchers = await prisma.voucher.findMany({
    where: { companyId: req.query.companyId as string },
    include: { files: { select: { id: true, filename: true, mimeType: true, size: true } } },
    orderBy: { uploadedAt: 'desc' },
    take: Math.min(Number(req.query.limit) || 200, 1000),
  });
  res.json(vouchers);
});

router.get('/:id', requireAuth, async (req, res) => {
  const voucher = await prisma.voucher.findUnique({
    where: { id: req.params.id },
    include: { files: { select: { id: true, filename: true, mimeType: true, size: true } } },
  });
  if (!voucher) return res.status(404).json({ error: 'Tositetta ei löydy' });
  if (!(await assertCompanyAccess(req, res, voucher.companyId))) return;
  res.json(voucher);
});

// Tositteen tiedosto esikatseluun (dashboard hakee tunnisteella ja avaa blobina)
router.get('/:id/file', requireAuth, async (req, res) => {
  try {
    const voucher = await prisma.voucher.findUnique({ where: { id: req.params.id }, include: { files: true } });
    if (!voucher || voucher.files.length === 0) return res.status(404).json({ error: 'Tositetta ei löydy' });
    if (!(await assertCompanyAccess(req, res, voucher.companyId))) return;
    const file = voucher.files[0];
    const data = await downloadFromS3(file.s3Bucket, file.s3Key);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
    res.send(data);
  } catch (error) {
    console.error('Voucher file error:', error);
    res.status(500).json({ error: 'Tiedoston haku epäonnistui' });
  }
});

/** Reitit sovellukseen (erillinen palvelu tai yhden prosessin palvelin, apps/server). */
export const mount = (app: Express) => {
  app.use('/api/v1/vouchers', express.json({ limit: '1mb' }), router);
};

// Saapuneet-kansio: inbox/<yhtiön tunnus>/tositteet/ -> tositteet luetaan automaattisesti
export const start = async () => {
  await connectProducer();
  startInboxWatcher({
    subfolder: 'tositteet',
    extensions: Object.keys(MIME_BY_EXT),
    handle: async (companyId, f) => {
      const voucher = await createVoucher(companyId, {
        buffer: f.buffer,
        originalname: f.filename,
        mimetype: MIME_BY_EXT[path.extname(f.filename).toLowerCase()],
        size: f.buffer.length,
      }, 'inbox');
      return `tosite ${voucher.id} luetaan`;
    },
    });
};

export const stop = async () => {
  if (!localBusEnabled()) await producer.disconnect().catch(() => undefined);
  await prisma.$disconnect();
};
