import 'dotenv/config';
import express from 'express';
import { mount, start } from './app';
import { corsMiddleware, errorHandler, notFound, securityHeaders } from './middleware/security';

const app = express();
const port = process.env.PORT || 3009;

app.disable('x-powered-by');
// Oikea asiakkaan IP myös välityspalvelimen takana
app.set('trust proxy', true);
app.use(securityHeaders, corsMiddleware());
mount(app);
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'audit-service', timestamp: new Date().toISOString() }));
app.use(notFound);
app.use(errorHandler);

start();
app.listen(port, () => console.log(`Audit Service running on port ${port}`));
