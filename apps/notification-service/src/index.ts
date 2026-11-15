import 'dotenv/config';
import express from 'express';
import { mount, start } from './app';
import { corsMiddleware, errorHandler, notFound, securityHeaders } from './middleware/security';

const app = express();
const port = process.env.PORT || 3008;

app.disable('x-powered-by');
app.use(securityHeaders, corsMiddleware());
mount(app);
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'notification-service', timestamp: new Date().toISOString() }));
app.use(notFound);
app.use(errorHandler);

start();
app.listen(port, () => console.log(`Notification Service running on port ${port}`));
