import express, { Express } from 'express';
import invoiceRoutes from './routes/invoiceRoutes';
import { prisma } from './db';
import { connectKafka, disconnectKafka } from './utils/kafka';

/** Reitit sovellukseen (erillinen palvelu tai yhden prosessin palvelin, apps/server). */
export const mount = (app: Express) => {
  app.use('/api/v1/invoices', express.json({ limit: '2mb' }), invoiceRoutes);
};
export const start = async () => { await connectKafka(); };
export const stop = async () => { await disconnectKafka(); await prisma.$disconnect(); };
