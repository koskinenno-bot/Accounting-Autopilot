import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bankRoutes from './routes/bankRoutes';
import { connectProducer, disconnectProducer } from './utils/kafka';
import { startInboxWatcher } from './utils/inboxWatcher';
import { importStatement } from './services/statementImporter';
import { startSyncScheduler } from './controllers/connectionController';

const app = express();
const port = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());

// Connect Kafka
connectProducer();

// Routes
app.use('/api/v1/bank', bankRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'bank-service',
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`Bank Service running on port ${port}`);
});

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

process.on('SIGTERM', async () => {
  await disconnectProducer();
  process.exit(0);
});
