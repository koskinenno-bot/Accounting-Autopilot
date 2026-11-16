/**
 * Yhden prosessin palvelimen ympäristömuuttujat.
 *
 * Järjestys (ensimmäinen voittaa):
 *   1. käynnistävän komentorivin / järjestelmän muuttujat
 *   2. apps/server/.env
 *   3. palveluiden omat apps/<palvelu>/.env -tiedostot (vanha tapa), jolloin
 *      olemassa oleva kehitysympäristö toimii ilman uutta asetustiedostoa.
 *
 * Palveluiden DATABASE_URL muutetaan muotoon <PALVELU>_DATABASE_URL, koska jokaisella
 * palvelulla on oma kantansa mutta prosessin ympäristö on yhteinen. PORT ja DATABASE_URL
 * jätetään pois yhteisestä ympäristöstä.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

/** Node-palvelut: kansio, muuttujien etuliite, palvelun URL-muuttuja. */
export const NODE_SERVICES = [
  { dir: 'user-service', prefix: 'USER', urlVar: 'USER_SERVICE_URL' },
  { dir: 'accounting-service', prefix: 'ACCOUNTING', urlVar: 'ACCOUNTING_SERVICE_URL' },
  { dir: 'voucher-service', prefix: 'VOUCHER', urlVar: 'VOUCHER_SERVICE_URL' },
  { dir: 'invoicing-service', prefix: 'INVOICING', urlVar: 'INVOICING_SERVICE_URL' },
  { dir: 'bank-service', prefix: 'BANK', urlVar: 'BANK_SERVICE_URL' },
  { dir: 'document-service', prefix: 'DOCUMENT', urlVar: 'DOCUMENT_SERVICE_URL' },
  { dir: 'notification-service', prefix: 'NOTIFICATION', urlVar: 'NOTIFICATION_SERVICE_URL' },
  { dir: 'audit-service', prefix: 'AUDIT', urlVar: 'AUDIT_SERVICE_URL' },
] as const;

/** Muuttujat, joiden pitää olla kaikilla palveluilla samat (muuten tunnisteet eivät kelpaa ristiin). */
const MUST_MATCH = ['JWT_SECRET', 'SERVICE_TOKEN'];
const PER_SERVICE = new Set(['PORT', 'DATABASE_URL']);

export interface EnvResult {
  env: Record<string, string>;
  warnings: string[];
}

/**
 * Laskee lopullisen ympäristön. Puhdas funktio (ei lue levyä): testattavissa.
 * @param base nykyinen process.env
 * @param serverFile apps/server/.env jäsennettynä (tai tyhjä)
 * @param serviceFiles palvelukansio -> sen .env jäsennettynä
 * @param port palvelimen portti
 */
export const buildEnv = (
  base: Record<string, string | undefined>,
  serverFile: Record<string, string>,
  serviceFiles: Record<string, Record<string, string>>,
  port: number,
  root: string,
): EnvResult => {
  const env: Record<string, string> = {};
  const warnings: string[] = [];
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v;
  const setIfMissing = (k: string, v: string | undefined) => {
    if (v !== undefined && v !== '' && (env[k] === undefined || env[k] === '')) env[k] = v;
  };

  for (const [k, v] of Object.entries(serverFile)) if (k !== 'PORT' || !env.PORT) setIfMissing(k, v);

  for (const svc of NODE_SERVICES) {
    const file = serviceFiles[svc.dir] || {};
    setIfMissing(`${svc.prefix}_DATABASE_URL`, file.DATABASE_URL);
    for (const [k, v] of Object.entries(file)) {
      if (PER_SERVICE.has(k) || k.endsWith('_SERVICE_URL')) continue;
      if (MUST_MATCH.includes(k) && env[k] && v && env[k] !== v) {
        warnings.push(`${svc.dir}/.env: ${k} poikkeaa muista, käytetään ensimmäistä arvoa`);
        continue;
      }
      setIfMissing(k, v);
    }
  }
  // Python-palveluiden avaimet (esim. ANTHROPIC_API_KEY) välitetään niille sellaisinaan
  for (const dir of ['reporting-service', 'ml-service']) {
    for (const [k, v] of Object.entries(serviceFiles[dir] || {})) {
      if (PER_SERVICE.has(k) || k.endsWith('_SERVICE_URL') || MUST_MATCH.includes(k)) continue;
      setIfMissing(k, v);
    }
  }

  for (const svc of NODE_SERVICES) {
    if (!env[`${svc.prefix}_DATABASE_URL`]) warnings.push(`${svc.prefix}_DATABASE_URL puuttuu (${svc.dir})`);
  }

  // Palvelut kutsuvat toisiaan saman prosessin HTTP-portin kautta (sama koodi kuin erillisinä)
  const self = `http://127.0.0.1:${port}/api/v1`;
  for (const svc of NODE_SERVICES) env[svc.urlVar] = self;
  setIfMissing('REPORTING_SERVICE_URL', 'http://127.0.0.1:3006/api/v1');
  setIfMissing('ML_SERVICE_URL', 'http://127.0.0.1:8001/api/v1');
  setIfMissing('EVENT_BUS', 'local');
  setIfMissing('KAFKAJS_NO_PARTITIONER_WARNING', '1');
  // Tositteet levylle, ellei MinIOta ole erikseen määritetty
  setIfMissing('VOUCHER_STORAGE', env.MINIO_ENDPOINT ? 's3' : 'local');
  setIfMissing('INBOX_DIR', path.join(root, 'inbox'));
  setIfMissing('APP_URL', `http://localhost:${port}`);
  setIfMissing('DASHBOARD_URL', env.APP_URL);
  // Sama alkuperä: selain puhuu vain tälle palvelimelle
  setIfMissing('CORS_ORIGINS', env.NODE_ENV === 'production' ? '' : `http://localhost:${port},http://localhost:5173`);

  for (const k of MUST_MATCH) if (!env[k]) warnings.push(`${k} puuttuu`);
  return { env, warnings };
};

export const readEnvFile = (file: string): Record<string, string> => {
  try {
    return dotenv.parse(fs.readFileSync(file));
  } catch {
    return {};
  }
};

/** Lukee .env-tiedostot ja kirjoittaa tuloksen process.env:iin. Kutsutaan ennen palveluiden latausta. */
export const loadEnv = (appsDir: string, port: number) => {
  const serviceFiles: Record<string, Record<string, string>> = {};
  for (const dir of [...NODE_SERVICES.map((s) => s.dir), 'reporting-service', 'ml-service']) {
    serviceFiles[dir] = readEnvFile(path.join(appsDir, dir, '.env'));
  }
  const result = buildEnv(process.env, readEnvFile(path.join(appsDir, 'server', '.env')), serviceFiles, port, path.resolve(appsDir, '..'));
  for (const [k, v] of Object.entries(result.env)) process.env[k] = v;
  return result;
};
