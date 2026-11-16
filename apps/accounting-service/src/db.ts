import axios from 'axios';
import { PrismaClient } from '../prisma/client';
import { serviceHeaders } from './middleware/requireAuth';

const AUDIT_SERVICE_URL = process.env.AUDIT_SERVICE_URL || 'http://localhost:3009/api/v1';

/**
 * Yksi jaettu PrismaClient koko palvelulle.
 * Aiemmin jokainen tiedosto loi oman instanssinsa, jolloin alla oleva
 * audit-middleware (KPL 2:6 §) koski vain index.ts:n instanssia eikä
 * yhtään oikeaa kirjausta. Lisäksi useat instanssit avaavat turhia yhteyksiä.
 */
// Yhden prosessin tilassa (apps/server) palvelun kanta on ACCOUNTING_DATABASE_URL, muuten DATABASE_URL
export const prisma = new PrismaClient({ datasourceUrl: process.env.ACCOUNTING_DATABASE_URL || undefined });

/**
 * Hetkellinen tietokantavirhe (yhteysallas täynnä, transaktiota ei saatu aloitettua, kirjoituskonflikti).
 * Tapahtumankäsittelijät heittävät nämä eteenpäin, jolloin väylä (Kafka tai paikallinen) yrittää uudelleen.
 * Aiemmin virhe vain lokitettiin: vuosiajossa tammikuun ostolaskuja jäi kokonaan kirjaamatta, kun usean
 * tositteen luku valmistui yhtä aikaa ("Unable to start a transaction in the given time").
 */
export const isTransientDbError = (err: any): boolean =>
  ['P1001', 'P1017', 'P2024', 'P2028', 'P2034'].includes(err?.code)
  || /Unable to start a transaction|Timed out fetching a new connection|could not serialize/i.test(String(err?.message));

/** Interaktiivisen transaktion odotusajat: ruuhkassa odotetaan yhteyttä pidempään kuin oletus 2 s. */
export const TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 } as const;

// Audit-palvelun AuditAction-enum tuntee vain nämä kolme arvoa.
const AUDIT_ACTION_MAP: Record<string, 'CREATE' | 'UPDATE' | 'DELETE'> = {
  create: 'CREATE',
  createMany: 'CREATE',
  update: 'UPDATE',
  updateMany: 'UPDATE',
  upsert: 'UPDATE',
  delete: 'DELETE',
  deleteMany: 'DELETE',
};

// Payee jätetään pois: muutoslokiin ei viedä henkilötunnuksia.
const SENSITIVE_MODELS = ['AccountingEntry', 'AccountingLine', 'FiscalYear', 'Account', 'PayrollRun', 'PayrollSettings', 'ConstructionContract'];

// --- KPL 2:6 § Compliance Middleware (Automated Audit Trail) ---
prisma.$use(async (params: any, next: any) => {
  const result = await next(params);

  const auditAction = AUDIT_ACTION_MAP[params.action];
  if (auditAction && SENSITIVE_MODELS.includes(params.model || '')) {
    // Uudelleenyritys (1 s, 4 s), jos lokipalvelu on hetkellisesti ruuhkainen tai alhaalla; 4xx ei korjaannu yrittämällä
    const post = (body: unknown, attempt = 0): Promise<unknown> =>
      axios.post(`${AUDIT_SERVICE_URL}/audit/log`, body, { headers: serviceHeaders(), timeout: 20_000 }).catch((err) => {
        const status = err?.response?.status;
        if (attempt >= 2 || (status && status < 500)) throw err;
        return new Promise((r) => setTimeout(r, 1000 * 4 ** attempt)).then(() => post(body, attempt + 1));
      });
    post({
        companyId: result?.companyId || params.args?.data?.companyId || null,
        userId: 'system-db-trigger',
        action: auditAction,
        entityType: params.model?.toUpperCase(),
        entityId: result?.id || 'MULTIPLE',
        description: `Automaattinen tietokantatason lokitus: ${params.model}.${params.action}`,
        changes: { args: params.args },
      })
      .catch((err) => console.error('Audit-lokitus epäonnistui:', err.message));
  }

  return result;
});
