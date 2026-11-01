import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bankRoutes from './routes/bankRoutes';
import { connectProducer, disconnectProducer } from './utils/kafka';

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

process.on('SIGTERM', async () => {
  await disconnectProducer();
  process.exit(0);
});
