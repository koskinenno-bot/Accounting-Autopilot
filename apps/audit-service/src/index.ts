import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import auditRoutes from './routes/auditRoutes';

const app = express();
const port = process.env.PORT || 3009;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
// Oikea asiakkaan IP myös Kong-gatewayn takana
app.set('trust proxy', true);

app.use('/api/v1/audit', auditRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'audit-service', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Audit Service running on port ${port}`);
});
