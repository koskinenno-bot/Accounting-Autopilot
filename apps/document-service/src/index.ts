import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import documentRoutes from './routes/documentRoutes';
import { requireAuth } from './middleware/requireAuth';

const app = express();
const port = process.env.PORT || 3007;

// Ensure uploads directory exists
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

app.use(cors());
app.use(express.json());
// Tiedostot vain kirjautuneille (aiemmin kaikki ladatut dokumentit olivat julkisesti saatavilla)
app.use('/uploads', requireAuth, express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/v1/documents', documentRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'document-service',
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`Document Service running on port ${port}`);
});
