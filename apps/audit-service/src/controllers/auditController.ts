import { Request, Response } from 'express';
import { PrismaClient, AuditAction } from '../../prisma/client';

const prisma = new PrismaClient();

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

    const auditLog = await prisma.auditLog.create({
      data: {
        companyId: companyId ?? null,
        userId: userId ?? (req as any).user?.userId ?? null,
        action: normalizedAction as AuditAction,
        entityType: String(entityType),
        entityId: entityId != null ? String(entityId) : null,
        description,
        // JSON-sarjallistus poistaa esim. Decimal/Date-oliot, joita Prisma ei hyväksy Json-kenttään sellaisenaan
        changes: changes === undefined ? undefined : JSON.parse(JSON.stringify(changes)),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
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
