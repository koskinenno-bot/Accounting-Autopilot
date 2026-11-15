/**
 * Enable Banking -tilitietorajapinta (PSD2/AIS). https://enablebanking.com/docs/api/reference/
 *
 * Kulku: POST /auth -> käyttäjä tunnistautuu pankissa -> paluu redirect-osoitteeseen ?code&state
 * -> POST /sessions { code } -> tilit (uid) -> GET /accounts/{uid}/transactions.
 * Jokainen kutsu allekirjoitetaan sovelluksen yksityisellä avaimella (JWT RS256, kid = sovellustunnus).
 *
 * Avain: ENABLE_BANKING_KEY_PATH tai ensimmäinen *.pem kansiossa apps/bank-service/salaiset/.
 * Sovellustunnus: ENABLE_BANKING_APP_ID tai .pem-tiedoston nimi (Enable Banking nimeää avaimen tunnuksella).
 */
import { createHash, createSign } from 'crypto';
import fs from 'fs';
import path from 'path';
import { BankTransaction } from './camtParser';

export interface EnableBankingConfig { appId: string; privateKey: string; apiUrl: string; redirectUrl: string }

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/** JWT Enable Bankingille: iss/aud kiinteät, voimassa enintään tunnin. */
export const makeJwt = (appId: string, privateKey: string, nowSeconds = Math.floor(Date.now() / 1000), ttl = 3600) => {
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId }));
  const body = b64url(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: nowSeconds, exp: nowSeconds + ttl }));
  const signature = createSign('RSA-SHA256').update(`${header}.${body}`).sign(privateKey);
  return `${header}.${body}.${b64url(signature)}`;
};

const KEY_DIR = path.resolve(__dirname, '../../salaiset');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lukee asetukset; null = pankkiyhteyttä ei ole vielä otettu käyttöön (avain puuttuu). */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env, keyDir = KEY_DIR): EnableBankingConfig | null => {
  let keyPath = env.ENABLE_BANKING_KEY_PATH;
  if (!keyPath && fs.existsSync(keyDir)) {
    const pem = fs.readdirSync(keyDir).filter((f) => f.toLowerCase().endsWith('.pem')).sort()[0];
    if (pem) keyPath = path.join(keyDir, pem);
  }
  if (!keyPath || !fs.existsSync(keyPath)) return null;
  const appId = env.ENABLE_BANKING_APP_ID || path.basename(keyPath).replace(/\.pem$/i, '');
  if (!UUID_RE.test(appId)) return null;
  return {
    appId,
    privateKey: fs.readFileSync(keyPath, 'utf8'),
    apiUrl: (env.ENABLE_BANKING_API_URL || 'https://api.enablebanking.com').replace(/\/$/, ''),
    redirectUrl: env.ENABLE_BANKING_REDIRECT_URL || 'http://localhost:5173/bank-connections/callback',
  };
};

export class BankApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

type Fetch = typeof fetch;

export interface EbAccount { uid: string; account_id?: { iban?: string }; name?: string; currency?: string }
export interface EbSession { session_id: string; accounts: EbAccount[]; access?: { valid_until?: string }; aspsp?: { name: string; country: string } }

export const createClient = (config: EnableBankingConfig, fetchImpl: Fetch = fetch) => {
  const call = async <T>(method: string, p: string, body?: unknown): Promise<T> => {
    let res: Response;
    try {
      res = await fetchImpl(`${config.apiUrl}${p}`, {
        method,
        headers: { Authorization: `Bearer ${makeJwt(config.appId, config.privateKey)}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err: any) {
      throw new BankApiError(503, `Enable Bankingiin ei saatu yhteyttä: ${err.message}`);
    }
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.message || data?.detail || data?.error || `HTTP ${res.status}`;
      throw new BankApiError(res.status, `Enable Banking: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`, data?.error);
    }
    return data as T;
  };
  return {
    aspsps: (country: string) => call<{ aspsps: any[] }>('GET', `/aspsps?country=${encodeURIComponent(country)}`),
    startAuth: (input: { aspspName: string; aspspCountry: string; validUntil: Date; state: string; psuType: string }) =>
      call<{ url: string; authorization_id?: string }>('POST', '/auth', {
        access: { valid_until: input.validUntil.toISOString() },
        aspsp: { name: input.aspspName, country: input.aspspCountry },
        state: input.state,
        redirect_url: config.redirectUrl,
        psu_type: input.psuType,
      }),
    createSession: (code: string) => call<EbSession>('POST', '/sessions', { code }),
    deleteSession: (sessionId: string) => call<unknown>('DELETE', `/sessions/${encodeURIComponent(sessionId)}`),
    balances: (uid: string) => call<{ balances: any[] }>('GET', `/accounts/${encodeURIComponent(uid)}/balances`),
    transactionsPage: (uid: string, dateFrom: string, continuationKey?: string) => {
      const q = new URLSearchParams({ date_from: dateFrom });
      if (continuationKey) q.set('continuation_key', continuationKey);
      return call<{ transactions: any[]; continuation_key?: string | null }>('GET', `/accounts/${encodeURIComponent(uid)}/transactions?${q}`);
    },
  };
};
export type EnableBankingClient = ReturnType<typeof createClient>;

/** Kaikki sivut (continuation_key). Raja estää loputtoman silmukan, jos pankki palauttaa saman avaimen. */
export const fetchAllTransactions = async (client: Pick<EnableBankingClient, 'transactionsPage'>, uid: string, dateFrom: string, maxPages = 100) => {
  const all: any[] = [];
  let key: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await client.transactionsPage(uid, dateFrom, key);
    all.push(...(res.transactions || []));
    if (!res.continuation_key || res.continuation_key === key) return all;
    key = res.continuation_key;
  }
  throw new BankApiError(502, `Tapahtumia yli ${maxPages} sivua; hae lyhyempi jakso`);
};

/** RF-viite (RFxx + kansallinen viite) -> kansallinen viite, jotta täsmäytys laskuihin toimii. */
export const normalizeReference = (raw?: string | null): string | undefined => {
  const s = (raw || '').replace(/\s+/g, '').toUpperCase();
  if (!s) return undefined;
  const rf = /^RF\d{2}(\d{1,21})$/.exec(s);
  return rf ? rf[1] : s;
};

const remittanceText = (r: unknown): string | undefined => {
  const parts = (Array.isArray(r) ? r : r ? [r] : []).map((x) => String(x).trim()).filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
};

/** Varaviite vain jos viesti on pelkkä viitenumero (esim. "RF18 1234 5" tai "12345 6"). */
const referenceFromRemittance = (text?: string) => {
  const s = (text || '').replace(/\s+/g, '');
  return /^(RF\d{2}\d{1,21}|\d{4,20})$/i.test(s) ? normalizeReference(s) : undefined;
};

/**
 * Enable Bankingin tapahtuma -> sama BankTransaction kuin tiliotetiedostoista.
 * Vain kirjatut (BOOK) tapahtumat; varaukset (PDNG) haetaan uudelleen, kun ne kirjautuvat.
 * entryReference = pankin arkistointitunnus: sama tapahtuma ei kirjaudu kahdesti (myöskään camt-tuonnin kanssa).
 */
export const mapTransaction = (tx: any, accountUid: string): BankTransaction | null => {
  if (tx?.status && tx.status !== 'BOOK') return null;
  const amount = Math.round(Math.abs(Number(tx?.transaction_amount?.amount)) * 100) / 100;
  const bookingDate = tx?.booking_date || tx?.value_date || tx?.transaction_date;
  if (!bookingDate || !Number.isFinite(amount) || amount === 0) return null;
  const negative = Number(tx.transaction_amount.amount) < 0;
  const creditDebit: 'CRDT' | 'DBIT' = tx.credit_debit_indicator === 'DBIT' || (!tx.credit_debit_indicator && negative) ? 'DBIT' : 'CRDT';
  const party = creditDebit === 'CRDT' ? tx.debtor : tx.creditor;
  const partyAccount = creditDebit === 'CRDT' ? tx.debtor_account : tx.creditor_account;
  const remittanceInfo = remittanceText(tx.remittance_information);
  const entryReference = tx.entry_reference || tx.transaction_id
    || `EB${createHash('sha256').update([accountUid, bookingDate, creditDebit, amount, party?.name, remittanceInfo, tx.reference_number].join('|')).digest('hex').slice(0, 24)}`;
  return {
    bookingDate: String(bookingDate).slice(0, 10),
    amount,
    currency: tx.transaction_amount?.currency || 'EUR',
    creditDebit,
    referenceNumber: normalizeReference(tx.reference_number) || referenceFromRemittance(remittanceInfo),
    counterpartyName: party?.name || undefined,
    payerName: party?.name || undefined,
    payerIban: partyAccount?.iban?.replace(/\s+/g, '') || undefined,
    remittanceInfo,
    entryReference: String(entryReference),
  };
};

/** Kirjanpidon kannalta paras saldo: kirjattu päätössaldo ennen käytettävissä olevaa. */
export const pickBalance = (balances: any[]): number | null => {
  const order = ['CLBD', 'ITBD', 'XPCD', 'CLAV', 'ITAV', 'OPBD'];
  const sorted = [...(balances || [])].sort((a, b) => {
    const ia = order.indexOf(a?.balance_type); const ib = order.indexOf(b?.balance_type);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const amount = Number(sorted[0]?.balance_amount?.amount);
  return Number.isFinite(amount) ? amount : null;
};

/** Suostumuksen kesto: pankin enimmäisaika (sekunteina), kuitenkin enintään 180 päivää. */
export const consentValidUntil = (maximumConsentValiditySeconds: number | undefined, now = new Date()) => {
  const max = 180 * 24 * 3600;
  const seconds = Math.min(max, maximumConsentValiditySeconds && maximumConsentValiditySeconds > 0 ? maximumConsentValiditySeconds : max);
  return new Date(now.getTime() + (seconds - 60) * 1000);
};

/** Hakujakson alku: edellinen kirjauspäivä miinus 3 pv (myöhässä kirjautuvat), muuten yhteyden aloituspäivä. */
export const syncDateFrom = (lastBookingDate: Date | null | undefined, syncFrom: Date) => {
  if (!lastBookingDate) return syncFrom.toISOString().slice(0, 10);
  const d = new Date(lastBookingDate.getTime() - 3 * 86400_000);
  return (d < syncFrom ? syncFrom : d).toISOString().slice(0, 10);
};
