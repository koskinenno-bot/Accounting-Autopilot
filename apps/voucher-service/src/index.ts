import 'dotenv/config';
import express from 'express';
import { mount, start, stop } from './app';
import { corsMiddleware, errorHandler, notFound, securityHeaders } from './middleware/security';

const app = express();
const port = process.env.PORT || 3003;

app.disable('x-powered-by');
app.use(securityHeaders, corsMiddleware());
mount(app);
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'voucher-service' }));
app.use(notFound);
app.use(errorHandler);

start().catch((err) => console.error('Käynnistys epäonnistui:', err));
app.listen(port, () => console.log(`Voucher Service running on port ${port}`));

process.on('SIGTERM', async () => { await stop(); process.exit(0); });
