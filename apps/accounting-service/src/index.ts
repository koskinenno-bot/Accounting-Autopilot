// Ladataan .env ennen muita importteja, jotta niiden moduulitason process.env-luvut näkevät arvot.
import 'dotenv/config';
import express from 'express';
import { mount, start, stop } from './app';
import { corsMiddleware, errorHandler, notFound, securityHeaders } from './middleware/security';

const app = express();
const port = process.env.PORT || 3002;

app.disable('x-powered-by');
app.use(securityHeaders, corsMiddleware());
mount(app);
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'accounting-service' }));
app.use(notFound);
app.use(errorHandler);

start();
app.listen(port, () => console.log(`Accounting Service running on port ${port}`));
process.on('SIGTERM', async () => { await stop(); process.exit(0); });
