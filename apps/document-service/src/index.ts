import 'dotenv/config';
import express from 'express';
import { mount, start } from './app';
import { corsMiddleware, errorHandler, notFound, securityHeaders } from './middleware/security';

const app = express();
const port = process.env.PORT || 3007;

app.disable('x-powered-by');
app.use(securityHeaders, corsMiddleware());
mount(app);
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'document-service', timestamp: new Date().toISOString() }));
app.use(notFound);
app.use(errorHandler);

start().then(() => app.listen(port, () => console.log(`Document Service running on port ${port}`)));
