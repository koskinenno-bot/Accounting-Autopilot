import { Request, Response } from 'express';
import { PrismaClient } from '../../prisma/client';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { assertCompanyAccess } from '../middleware/requireAuth';
import { closingArchiveItems, looksLikePdf, retentionUntil } from '../archive';

const REPORTING_SERVICE_URL = process.env.REPORTING_SERVICE_URL || 'http://localhost:3006/api/v1';
const ACCOUNTING_SERVICE_URL = process.env.ACCOUNTING_SERVICE_URL || 'http://localhost:3002/api/v1';
const UPLOAD_DIR = path.resolve('uploads');

const prisma = new PrismaClient();

export const uploadDocument = async (req: Request, res: Response) => {
  try {
    const file = req.file;
    const { companyId, name, type } = req.body;
    const userId = (req as any).user?.userId;

    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    if (!companyId) return res.status(400).json({ error: 'companyId is required' });

    const checksum = createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');

    // 1. Create or find Document record
    const document = await prisma.document.create({
      data: {
        companyId,
        name: name || file.originalname,
        type: type || 'OTHER',
        versions: {
          create: {
            filename: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            storagePath: file.path,
            checksum,
            createdBy: userId || 'SYSTEM',
            version: 1,
          }
        }
      },
      include: { versions: true }
    });

    res.status(201).json(document);
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  }
};

export const getDocuments = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.query;
    const documents = await prisma.document.findMany({
      where: { companyId: companyId as string },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(documents);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
};

export const archiveDocument = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const years = req.body?.retentionYears ?? 10;
    if (!Number.isInteger(years) || years < 6 || years > 50) return res.status(400).json({ error: 'Säilytysaika 6–50 vuotta' });

    const existing = await prisma.document.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Document not found' });
    if (!(await assertCompanyAccess(req, res, existing.companyId))) return;
    if (existing.isArchived) return res.status(409).json({ error: 'Dokumentti on jo arkistoitu' });

    const retentionUntil = new Date();
    retentionUntil.setFullYear(retentionUntil.getFullYear() + years);

    const document = await prisma.document.update({
      where: { id },
      data: {
        isArchived: true,
        archivedAt: new Date(),
        retentionUntil: retentionUntil,
      }
    });

    res.json({ message: 'Document archived and locked', document });
  } catch (error) {
    res.status(500).json({ error: 'Failed to archive document' });
  }
};

export const deleteDocument = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const document = await prisma.document.findUnique({ where: { id } });
    
    if (!document) return res.status(404).json({ error: 'Document not found' });
    if (!(await assertCompanyAccess(req, res, document.companyId))) return;
    if (document.isArchived) {
      return res.status(403).json({ error: 'Arkistoitua dokumenttia ei voi poistaa (säilytysaika)' });
    }

    await prisma.document.delete({ where: { id } });
    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete document' });
  }
};

/** GET /documents/:id/download : uusin versio, yhtiön käyttöoikeus tarkistetaan. Tiiviste tarkistetaan. */
export const downloadDocument = async (req: Request, res: Response) => {
  try {
    const document = await prisma.document.findUnique({
      where: { id: req.params.id }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!document || !document.versions[0]) return res.status(404).json({ error: 'Dokumenttia ei löydy' });
    if (!(await assertCompanyAccess(req, res, document.companyId, 'read'))) return;
    const v = document.versions[0];
    const file = path.resolve(v.storagePath);
    // Vain uploads-kansion tiedostot (polku tulee kannasta, mutta varmistetaan)
    if (!file.startsWith(UPLOAD_DIR + path.sep) || !fs.existsSync(file)) return res.status(410).json({ error: 'Tiedosto puuttuu arkistosta' });
    const content = fs.readFileSync(file);
    const checksum = createHash('sha256').update(content).digest('hex');
    if (checksum !== v.checksum) {
      console.error(`Tiivisteen ero: dokumentti ${document.id}`);
      return res.status(409).json({ error: 'Tiedoston eheystarkistus epäonnistui: tiedosto on muuttunut tallennuksen jälkeen' });
    }
    res.setHeader('Content-Type', v.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(v.filename)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(content);
  } catch (error) {
    console.error('Download error:', error);
    return res.status(500).json({ error: 'Lataus epäonnistui' });
  }
};

/**
 * POST /documents/closing-archive { companyId, fiscalYearId }
 * Tallentaa allekirjoitetun tilinpäätöksen PDF:t (tilinpäätös, tase-erittelyt, päiväkirja, pääkirja) arkistoon
 * lukittuina 10 vuodeksi. Jo arkistoidut aineistot ohitetaan.
 */
export const archiveClosing = async (req: Request, res: Response) => {
  try {
    const { companyId, fiscalYearId } = req.body ?? {};
    if (typeof fiscalYearId !== 'string' || !fiscalYearId) return res.status(400).json({ error: 'fiscalYearId on pakollinen' });
    if (!(await assertCompanyAccess(req, res, companyId, 'write'))) return;
    const auth = { Authorization: req.headers.authorization || '' };

    // Tilikausi ja allekirjoitus tarkistetaan kirjanpidosta
    const { data: pkg } = await axios.get(`${ACCOUNTING_SERVICE_URL}/accounting/fiscal-years/${encodeURIComponent(fiscalYearId)}/closing-package`, {
      headers: auth, timeout: 15_000,
    });
    if (pkg?.fiscalYear?.companyId && pkg.fiscalYear.companyId !== companyId) return res.status(400).json({ error: 'Tilikausi kuuluu toiseen yhtiöön' });
    if (!pkg?.signedAt) return res.status(409).json({ error: 'Arkistoidaan vasta allekirjoitettu tilinpäätös' });
    const end = new Date(pkg.fiscalYear.endDate);
    const year = String(end.getUTCFullYear());
    const until = retentionUntil(end);
    const userId = (req as any).user?.userId || 'SYSTEM';

    const archived: string[] = []; const skipped: string[] = [];
    for (const item of closingArchiveItems(fiscalYearId, year)) {
      const exists = await prisma.document.findUnique({ where: { companyId_sourceKey: { companyId, sourceKey: item.key } } });
      if (exists) { skipped.push(item.name); continue; }
      const { data } = await axios.get(`${REPORTING_SERVICE_URL}${item.path}`, {
        params: { companyId, fiscalYearId }, headers: auth, responseType: 'arraybuffer', timeout: 60_000,
      });
      const buf = Buffer.from(data);
      if (!looksLikePdf(buf)) throw new Error(`${item.name}: raporttipalvelu ei palauttanut PDF:ää`);
      const file = path.join(UPLOAD_DIR, `archive-${companyId}-${item.key.replace(/[^\w-]/g, '_')}-${Date.now()}.pdf`);
      fs.writeFileSync(file, buf);
      await prisma.document.create({
        data: {
          companyId, name: item.name, type: 'REPORT', isArchived: true, archivedAt: new Date(), retentionUntil: until, sourceKey: item.key,
          versions: { create: {
            filename: item.filename, mimeType: 'application/pdf', size: buf.length, storagePath: file,
            checksum: createHash('sha256').update(buf).digest('hex'), createdBy: userId,
          } },
        },
      });
      archived.push(item.name);
    }
    return res.status(201).json({ archived, skipped, retentionUntil: until });
  } catch (error: any) {
    const detail = error?.response?.data ? Buffer.isBuffer(error.response.data) ? error.response.data.toString('utf8').slice(0, 200) : JSON.stringify(error.response.data).slice(0, 200) : error?.message;
    console.error('Closing archive error:', detail);
    return res.status(502).json({ error: `Arkistointi epäonnistui: ${detail}` });
  }
};
