import express, { Express } from 'express';
import notificationRoutes from './routes/notificationRoutes';

/** Reitit sovellukseen (erillinen palvelu tai yhden prosessin palvelin, apps/server). */
export const mount = (app: Express) => {
  app.use('/api/v1/notify', express.json({ limit: '2mb' }), notificationRoutes);
};
export const start = async () => {
  // Sähköpostijonon käsittelijä (BullMQ). Käynnistyy, kun Redis vastaa; ilman Redistä viestit lähtevät suoraan.
  // require eikä import(): toimii sekä erillisenä palveluna että yhden prosessin palvelimessa
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('./worker');
};
