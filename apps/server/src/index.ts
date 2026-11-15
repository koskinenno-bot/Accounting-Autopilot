/**
 * Yhden prosessin palvelin: kaikki Node-palvelut samassa prosessissa ja portissa,
 * tapahtumat prosessin sisäisellä väylällä (EVENT_BUS=local), ei Kafkaa eikä Kongia.
 * Palvelee myös dashboardin (apps/admin-dashboard/dist) ja välittää raportit ja
 * tekoälyluvun Python-palveluille, jotka se käynnistää itse.
 *
 *   npm start --workspace @ai-accountant/server     (oletusportti 3000)
 *
 * Vanha tapa (jokainen palvelu omassa ikkunassaan, Kafka ja Kong) toimii edelleen.
 */
import fs from 'fs';
import path from 'path';
import { loadEnv, NODE_SERVICES } from './env';

const APPS = path.resolve(__dirname, '..', '..');
const port = Number(process.env.PORT) || 3000;
const { warnings } = loadEnv(APPS, port);
for (const w of warnings) console.warn(`VAROITUS: ${w}`);

// Palvelut luetaan vasta, kun ympäristö on valmis (ne lukevat osan asetuksista latautuessaan)
/* eslint-disable @typescript-eslint/no-var-requires */
import type { Express } from 'express';
const express = require('express') as typeof import('express');
const { proxyTo, ping } = require('./proxy') as typeof import('./proxy');
const { PYTHON_SERVICES, startPython, stopPython } = require('./python') as typeof import('./python');
const security = require('./middleware/security') as typeof import('./middleware/security');

interface ServiceApp { mount: (app: Express) => void; start?: () => Promise<void>; stop?: () => Promise<void> }
const services = NODE_SERVICES.map((s) => ({
  name: s.dir,
  mod: require(path.join(APPS, s.dir, 'src', 'app')) as ServiceApp,
}));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : 'loopback');
app.use(security.securityHeaders, security.corsMiddleware());

// Python-palvelut: runko välitetään sellaisenaan, siksi ennen JSON-jäsennintä
const REPORTING = process.env.REPORTING_SERVICE_URL!.replace(/\/api\/v1\/?$/, '');
const ML = process.env.ML_SERVICE_URL!.replace(/\/api\/v1\/?$/, '');
app.use('/api/v1/reports', proxyTo(REPORTING));
app.use('/api/v1/ml', proxyTo(ML));

for (const s of services) s.mod.mount(app);

app.get('/health', async (_req, res) => {
  const [reporting, ml] = await Promise.all([ping(`${REPORTING}/health`), ping(`${ML}/health`)]);
  res.status(reporting ? 200 : 503).json({
    status: reporting ? 'ok' : 'degraded',
    service: 'server',
    mode: 'single-process',
    eventBus: process.env.EVENT_BUS,
    services: services.map((s) => s.name),
    reporting: reporting ? 'ok' : 'ei vastaa',
    ml: ml ? 'ok' : 'ei vastaa',
    timestamp: new Date().toISOString(),
  });
});

// Dashboard (vite build) ja SPA-reitit: tuntematon polku, joka ei ole rajapinta, saa index.html:n
const DIST = path.resolve(process.env.DASHBOARD_DIST || path.join(APPS, 'admin-dashboard', 'dist'));
const INDEX = path.join(DIST, 'index.html');
if (fs.existsSync(INDEX)) {
  app.use(express.static(DIST, { index: false, maxAge: '1h', setHeaders: (res, file) => {
    // Vite nimeää assets-tiedostot sisällön tiivisteellä: ne voi välimuistittaa pitkään
    if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } }));
  app.get(/^\/(?!api\/|health$).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(INDEX);
  });
} else {
  console.warn(`Dashboardia ei löydy (${DIST}). Rakenna se: npm run build:single --workspace admin-dashboard`);
}

app.use(security.notFound);
app.use(security.errorHandler);

const main = async () => {
  if (process.env.PYTHON_SERVICES !== 'off') for (const p of PYTHON_SERVICES) startPython(APPS, p);
  for (const s of services) {
    try {
      await s.mod.start?.();
    } catch (err) {
      // Yhden palvelun taustatehtävän virhe ei kaada muita; reitit toimivat silti
      console.error(`${s.name}: käynnistys epäonnistui:`, err);
    }
  }
  const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');
  const server = app.listen(port, host, () => console.log(`Palvelin käynnissä: http://localhost:${port} (${services.length} palvelua, tapahtumat: ${process.env.EVENT_BUS})`));
  // Pitkät raportti- ja tositeluvut: älä katkaise kesken
  server.requestTimeout = 5 * 60_000;

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`${signal}: suljetaan`);
    stopPython();
    server.close();
    await Promise.allSettled(services.map((s) => s.mod.stop?.()));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
};

process.on('unhandledRejection', (err) => console.error('Käsittelemätön virhe:', err));
main();
