// Kopioi packages/config/auth/requireAuth.ts kaikkiin Node-palveluihin.
// Käyttö: node scripts/sync-auth.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'packages', 'config', 'auth', 'requireAuth.ts');
const securitySource = path.join(root, 'packages', 'config', 'http', 'security.ts');
const services = [
  'accounting-service', 'audit-service', 'bank-service', 'document-service',
  'invoicing-service', 'notification-service', 'voucher-service',
];

for (const service of services) {
  const target = path.join(root, 'apps', service, 'src', 'middleware', 'requireAuth.ts');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  console.log(`-> ${path.relative(root, target)}`);
  // HTTP-suojaukset (CORS, otsakkeet, virheenkäsittely)
  const secTarget = path.join(root, 'apps', service, 'src', 'middleware', 'security.ts');
  fs.copyFileSync(securitySource, secTarget);
  console.log(`-> ${path.relative(root, secTarget)}`);
}

// user-servicellä on oma tunnistautuminen, mutta samat HTTP-suojaukset; samoin yhden prosessin palvelimella
for (const app of ['user-service', 'server']) {
  const target = path.join(root, 'apps', app, 'src', 'middleware', 'security.ts');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(securitySource, target);
  console.log(`-> ${path.relative(root, target)}`);
}

// Saapuneet-kansion tarkkailija (tiliotteet ja tositteet)
const inboxSource = path.join(root, 'packages', 'config', 'inbox', 'inboxWatcher.ts');
for (const service of ['bank-service', 'voucher-service']) {
  const target = path.join(root, 'apps', service, 'src', 'utils', 'inboxWatcher.ts');
  fs.copyFileSync(inboxSource, target);
  console.log(`-> ${path.relative(root, target)}`);
}

// Paikallinen tapahtumaväylä (yhden prosessin tila)
const busSource = path.join(root, 'packages', 'config', 'events', 'localBus.ts');
for (const service of ['accounting-service', 'bank-service', 'invoicing-service', 'user-service', 'voucher-service']) {
  const target = path.join(root, 'apps', service, 'src', 'utils', 'localBus.ts');
  fs.copyFileSync(busSource, target);
  console.log(`-> ${path.relative(root, target)}`);
}
