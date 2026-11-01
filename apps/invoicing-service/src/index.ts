import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '../prisma/client';
import invoiceRoutes from './routes/invoiceRoutes';
import { connectKafka, disconnectKafka } from './utils/kafka';

const app = express();
const prisma = new PrismaClient();
const port = process.env.PORT || 3004;

app.use(cors());
app.use(express.json());

// Connect Kafka
connectKafka();

// Routes
app.use('/api/v1/invoices', invoiceRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'invoicing-service',
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`Invoicing Service running on port ${port}`);
});

process.on('SIGTERM', async () => {
  await disconnectKafka();
  await prisma.$disconnect();
  process.exit(0);
});
