import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '../prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { connectProducer } from './utils/kafka';
import { uploadToS3, bucketName, downloadFromS3 } from './utils/s3';
import { assertCompanyAccess, requireAuth, requireCompanyAccess } from './middleware/requireAuth';
import { processVoucher } from './processing';
import { createHash } from 'crypto';

const app = express();
const prisma = new PrismaClient();
const port = process.env.PORT || 3003;
const uploadDir = process.env.UPLOAD_DIR || './uploads';

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(cors());
app.use(express.json());

// Connect Kafka
connectProducer();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'voucher-service' });
});

// Voucher upload endpoint
app.post('/api/v1/vouchers/upload', requireAuth, upload.single('file'), requireCompanyAccess({ required: true }), async (req, res) => {
  try {
    const file = req.file;
    const { companyId, voucherType, voucherDate } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    // 1. Upload to S3/MinIO
    const s3Key = await uploadToS3(file);

    // 2. Create Voucher record
    const voucher = await prisma.voucher.create({
      data: {
        companyId,
        voucherType: voucherType || 'PURCHASE',
        voucherDate: new Date(voucherDate || Date.now()),
        ocrStatus: 'PENDING',
        status: 'UNPROCESSED',
        uploadedBy: (req as any).user?.userId || 'system',
        files: {
          create: {
            filename: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            s3Key: s3Key,
            s3Bucket: bucketName,
            checksum: createHash('sha256').update(file.buffer).digest('hex'), // eheyden todentaminen (KPL 2:10 §)
          }
        }
      },
      include: { files: true }
    });

    // 3. Luku taustalla (tekoäly voi kestää kymmeniä sekunteja); tila näkyy GET /vouchers/:id
    res.json({
      message: 'Tosite ladattu, luku käynnissä',
      voucherId: voucher.id,
      s3Key: s3Key
    });
    processVoucher(prisma, voucher.id, file).catch((err) => console.error(`Tositteen ${voucher.id} käsittely kaatui:`, err));
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Yhtiön tositteet (Käsittelemättömät-näkymä näyttää luvun tilan ja virheet)
app.get('/api/v1/vouchers', requireAuth, requireCompanyAccess({ required: true }), async (req, res) => {
  const vouchers = await prisma.voucher.findMany({
    where: { companyId: req.query.companyId as string },
    include: { files: { select: { id: true, filename: true, mimeType: true, size: true } } },
    orderBy: { uploadedAt: 'desc' },
    take: Math.min(Number(req.query.limit) || 200, 1000),
  });
  res.json(vouchers);
});

app.get('/api/v1/vouchers/:id', requireAuth, async (req, res) => {
  const voucher = await prisma.voucher.findUnique({
    where: { id: req.params.id },
    include: { files: { select: { id: true, filename: true, mimeType: true, size: true } } },
  });
  if (!voucher) return res.status(404).json({ error: 'Tositetta ei löydy' });
  if (!(await assertCompanyAccess(req, res, voucher.companyId))) return;
  res.json(voucher);
});

// Tositteen tiedosto esikatseluun (dashboard hakee tunnisteella ja avaa blobina)
app.get('/api/v1/vouchers/:id/file', requireAuth, async (req, res) => {
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

app.listen(port, () => {
  console.log(`Voucher Service running on port ${port}`);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
