import express, { Express } from 'express';
import fs from 'fs';
import documentRoutes from './routes/documentRoutes';
import { UPLOAD_DIR } from './controllers/documentController';

/** Reitit sovellukseen (erillinen palvelu tai yhden prosessin palvelin, apps/server). */
export const mount = (app: Express) => {
  // Tiedostot ladataan vain reitillä /documents/:id/download, joka tarkistaa yhtiön käyttöoikeuden.
  app.use('/api/v1/documents', express.json(), documentRoutes);
};

export const start = async () => {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
};
