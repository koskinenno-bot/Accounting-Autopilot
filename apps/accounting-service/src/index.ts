// Ladataan .env ennen muita importteja, jotta niiden moduulitason process.env-luvut näkevät arvot.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import accountingRoutes from './routes/accountingRoutes';
import { connectConsumer, disconnectConsumer } from './utils/kafka';
import { prisma } from './db';
import { syncChartTemplates } from './services/chartOfAccountsService';

const app = express();
const port = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// Connect consumer
connectConsumer();
// Uudet pohjatilit (esim. 1800 Siirtosaamiset, 2900 Siirtovelat, 6900 Poistot) myös vanhoille yhtiöille
syncChartTemplates().catch((err) => console.error('Tilikarttapohjan päivitys epäonnistui:', err));

// Routes
app.use('/api/v1/accounting', accountingRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'accounting-service' });
});

app.get('/', (req, res) => {
  res.json({ message: 'AI Accountant Accounting Service API with Legal Hardening' });
});

app.listen(port, () => {
  console.log(`Accounting Service (Compliance Hardened) running on port ${port}`);
});

process.on('SIGTERM', async () => {
  await disconnectConsumer();
  await prisma.$disconnect();
  process.exit(0);
});
