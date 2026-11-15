import express, { Express } from 'express';
import bankRoutes from './routes/bankRoutes';
import { connectProducer, disconnectProducer } from './utils/kafka';
import { startInboxWatcher } from './utils/inboxWatcher';
import { importStatement } from './services/statementImporter';
import { startSyncScheduler } from './controllers/connectionController';

/** Reitit sovellukseen (erillinen palvelu tai yhden prosessin palvelin, apps/server). */
export const mount = (app: Express) => {
  app.use('/api/v1/bank', express.json({ limit: '2mb' }), bankRoutes);
};

export const start = async () => {
  await connectProducer();
  // Saapuneet-kansio: inbox/<yhtiön tunnus>/tiliotteet/ -> tuonti automaattisesti
  startInboxWatcher({
    subfolder: 'tiliotteet',
    extensions: ['.xml', '.csv', '.txt', '.pdf'],
    handle: async (companyId, file) => {
      const result = await importStatement(companyId, file.buffer, file.filename);
      return `${result.transactionCount} tapahtumaa (${result.format})`;
    },
  });
  // Pankkiyhteyksien ajastettu haku (oletus 6 h välein, ENABLE_BANKING_SYNC_HOURS)
  startSyncScheduler();
};
export const stop = async () => { await disconnectProducer(); };
