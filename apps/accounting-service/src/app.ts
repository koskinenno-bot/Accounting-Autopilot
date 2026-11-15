import express, { Express } from 'express';
import accountingRoutes from './routes/accountingRoutes';
import { connectConsumer, disconnectConsumer } from './utils/kafka';
import { prisma } from './db';
import { syncChartTemplates } from './services/chartOfAccountsService';

/** Reitit sovellukseen (erillinen palvelu tai yhden prosessin palvelin, apps/server). */
export const mount = (app: Express) => {
  app.use('/api/v1/accounting', express.json({ limit: '2mb' }), accountingRoutes);
};

export const start = async () => {
  await connectConsumer();
  // Uudet pohjatilit (esim. 1800 Siirtosaamiset, 2900 Siirtovelat, 6900 Poistot) myös vanhoille yhtiöille
  syncChartTemplates().catch((err) => console.error('Tilikarttapohjan päivitys epäonnistui:', err));
};
export const stop = async () => { await disconnectConsumer(); await prisma.$disconnect(); };
