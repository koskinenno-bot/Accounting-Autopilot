import express, { Express } from 'express';
import authRoutes from './routes/authRoutes';
import companyRoutes from './routes/companyRoutes';
import shareholderRoutes from './routes/shareholderRoutes';
import organizationRoutes from './routes/organizationRoutes';
import invitationRoutes from './routes/invitationRoutes';
import portalRoutes from './routes/portalRoutes';
import { prisma } from './db';
import { connectProducer, disconnectProducer } from './utils/kafka';

/** Reitit sovellukseen (erillinen palvelu tai yhden prosessin palvelin, apps/server). */
export const mount = (app: Express) => {
  const json = express.json({ limit: '2mb' }); // osakasluettelon CSV-tuonti
  app.use('/api/v1/auth', json, authRoutes);
  app.use('/api/v1/companies', json, companyRoutes);
  app.use('/api/v1/shareholders', json, shareholderRoutes);
  app.use('/api/v1/organizations', json, organizationRoutes);
  app.use('/api/v1/invitations', json, invitationRoutes);
  app.use('/api/v1/portal', json, portalRoutes);
};

export const start = async () => { await connectProducer(); };
export const stop = async () => { await disconnectProducer(); await prisma.$disconnect(); };
