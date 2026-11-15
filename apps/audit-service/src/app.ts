import express, { Express } from 'express';
import auditRoutes from './routes/auditRoutes';
import { prisma } from './controllers/auditController';
import { ensureImmutable } from './immutability';

/** Reitit sovellukseen (erillinen palvelu tai yhden prosessin palvelin, apps/server). */
export const mount = (app: Express) => {
  app.use('/api/v1/audit', express.json({ limit: '2mb' }), auditRoutes);
};
/** Tietokantatriggeri estää muutoslokin muuttamisen ja poistamisen. */
export const start = async () => { await ensureImmutable(prisma); };
