import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '../prisma/client';
import authRoutes from './routes/authRoutes';
import companyRoutes from './routes/companyRoutes';
import shareholderRoutes from './routes/shareholderRoutes';
import { connectProducer, disconnectProducer } from './utils/kafka';

const app = express();
const prisma = new PrismaClient();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Connect producer
connectProducer();

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/companies', companyRoutes);
app.use('/api/v1/shareholders', shareholderRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'user-service' });
});

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'AI Accountant User Service API' });
});

app.listen(port, () => {
  console.log(`User Service running on port ${port}`);
});

process.on('SIGTERM', async () => {
  await disconnectProducer();
  await prisma.$disconnect();
  process.exit(0);
});
