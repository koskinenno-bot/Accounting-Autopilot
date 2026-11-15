import 'dotenv/config';
import express from 'express';
import { mount, start, stop } from './app';
import { corsMiddleware, errorHandler, notFound, securityHeaders } from './middleware/security';

const app = express();
const port = process.env.PORT || 3001;

app.disable('x-powered-by');
app.use(securityHeaders, corsMiddleware());
mount(app);
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'user-service' }));
app.use(notFound);
app.use(errorHandler);

start();
app.listen(port, () => console.log(`User Service running on port ${port}`));
process.on('SIGTERM', async () => { await stop(); process.exit(0); });
