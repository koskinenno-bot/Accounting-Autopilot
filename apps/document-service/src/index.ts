import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import documentRoutes from './routes/documentRoutes';

const app = express();
const port = process.env.PORT || 3007;

// Ensure uploads directory exists
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

app.use(cors());
app.use(express.json());
// Tiedostot ladataan vain reitillä /documents/:id/download, joka tarkistaa yhtiön käyttöoikeuden.
// (Aiempi /uploads-kansion jako näytti minkä tahansa yhtiön tiedoston kenelle tahansa kirjautuneelle.)

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
