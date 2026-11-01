import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import notificationRoutes from './routes/notificationRoutes';
import './worker'; // Initializing the BullMQ worker

const app = express();
const port = process.env.PORT || 3008;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/v1/notify', notificationRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'notification-service',
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`Notification Service running on port ${port}`);
});
