import { Request, Response } from 'express';
import crypto from 'crypto';
import { PrismaClient, AuditAction } from '../../prisma/client';
import { nextTimestamp, recordHash, verifyChain } from '../chain';

export const prisma = new PrismaClient();

const ACTIONS: string[] = Object.values(AuditAction);

export const logEvent = async (req: Request, res: Response) => {
  try {
    const { companyId, userId, action, entityType, entityId, description, changes } = req.body ?? {};

    const normalizedAction = typeof action === 'string' ? action.toUpperCase() : '';
    if (!ACTIONS.includes(normalizedAction)) {
      return res.status(400).json({ error: `Tuntematon action '${action}'. Sallitut: ${ACTIONS.join(', ')}` });
    }
    if (!entityType) {
      return res.status(400).json({ error: 'entityType on pakollinen' });
    }

    const fields = {
      id: crypto.randomUUID(),
      companyId: companyId ? String(companyId) : null,
      userId: userId ?? (req as any).user?.userId ?? null,
      action: normalizedAction,
      entityType: String(entityType),
      entityId: entityId != null ? String(entityId) : null,
      description: description ?? null,
      // JSON-sarjallistus poistaa esim. Decimal/Date-oliot, joita Prisma ei hyväksy Json-kenttään sellaisenaan
      changes: changes === undefined ? null : JSON.parse(JSON.stringify(changes)),
    };
    // Yhtiön ketjuun lisätään yksi tapahtuma kerrallaan (transaktiokohtainen lukko yhtiön tunnisteesta)
    const auditLog = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'audit:' + (fields.companyId ?? '-')}))`;
      const last = await tx.auditLog.findFirst({
        where: { companyId: fields.companyId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { hash: true, createdAt: true },
      });
      const createdAt = nextTimestamp(last?.createdAt ?? null);
      const prevHash = last?.hash ?? null;
      const hash = recordHash(prevHash, { ...fields, createdAt });
      return tx.auditLog.create({
        data: {
          ...fields,
          action: normalizedAction as AuditAction,
          changes: fields.changes === null ? undefined : fields.changes,
          createdAt, prevHash, hash,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });
    });

    res.status(201).json(auditLog);
  } catch (error) {
    console.error('Audit log error:', error);
    res.status(500).json({ error: 'Failed to record audit log' });
  }
};

export const getLogs = async (req: Request, res: Response) => {
  try {
    const { companyId, entityType, action, entityId } = req.query;
    const take = Math.min(Number(req.query.limit) || 200, 1000);

    const logs = await prisma.auditLog.findMany({
      where: {
        companyId: companyId ? String(companyId) : undefined,
        entityType: entityType ? String(entityType) : undefined,
        entityId: entityId ? String(entityId) : undefined,
        action: action && ACTIONS.includes(String(action)) ? (String(action) as AuditAction) : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
};

/** Yhtiön muutoslokin eheyden tarkistus (tiivisteketju). */
export const verifyLogs = async (req: Request, res: Response) => {
  try {
    const companyId = String(req.query.companyId);
    const rows = await prisma.auditLog.findMany({ where: { companyId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    res.json(verifyChain(rows.map((r) => ({ ...r, action: String(r.action), changes: r.changes ?? null }))));
  } catch (error) {
    console.error('Audit verify error:', error);
    res.status(500).json({ error: 'Tarkistus epäonnistui' });
  }
};
