// Kopioi packages/config/auth/requireAuth.ts kaikkiin Node-palveluihin.
// Käyttö: node scripts/sync-auth.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'packages', 'config', 'auth', 'requireAuth.ts');
const services = [
  'accounting-service', 'audit-service', 'bank-service', 'document-service',
  'invoicing-service', 'notification-service', 'voucher-service',
];

for (const service of services) {
  const target = path.join(root, 'apps', service, 'src', 'middleware', 'requireAuth.ts');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  console.log(`-> ${path.relative(root, target)}`);
}
