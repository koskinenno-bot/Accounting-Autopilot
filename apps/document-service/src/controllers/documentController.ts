import { Request, Response } from 'express';
import { PrismaClient } from '../../prisma/client';
import { createHash } from 'crypto';
import fs from 'fs';
import { assertCompanyAccess } from '../middleware/requireAuth';

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
    const { retentionYears } = req.body;

    const existing = await prisma.document.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Document not found' });
    if (!(await assertCompanyAccess(req, res, existing.companyId))) return;

    const retentionUntil = new Date();
    retentionUntil.setFullYear(retentionUntil.getFullYear() + (retentionYears || 10));

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
      return res.status(403).json({ error: 'Archived documents cannot be deleted' });
    }

    await prisma.document.delete({ where: { id } });
    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete document' });
  }
};
