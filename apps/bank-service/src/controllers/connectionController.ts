import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { prisma } from '../db';
import { assertCompanyAccess, serviceHeaders } from '../middleware/requireAuth';
import { reportBalance } from '../services/balanceReport';
import { BankApiError, EnableBankingClient, consentValidUntil, createClient, loadConfig } from '../services/enableBanking';
import { syncAccount } from '../services/bankSync';
import { publishBankStatementReceived } from '../utils/kafka';

const AUDIT_SERVICE_URL = process.env.AUDIT_SERVICE_URL || 'http://localhost:3009/api/v1';

let clientFactory: () => EnableBankingClient | null = () => {
  const config = loadConfig();
  return config ? createClient(config) : null;
};
/** Testejä varten. */
export const setClientFactory = (f: () => EnableBankingClient | null) => { clientFactory = f; };

const userId = (req: Request) => (req as any).user?.userId || 'unknown';

const audit = (companyId: string, user: string, action: 'CREATE' | 'UPDATE' | 'DELETE', entityId: string, description: string) => {
  fetch(`${AUDIT_SERVICE_URL}/audit/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...serviceHeaders() },
    body: JSON.stringify({ companyId, userId: user, action, entityType: 'BANK_CONNECTION', entityId, description }),
  }).catch((err) => console.error('Audit-lokitus epäonnistui:', err.message));
};

const fail = (res: Response, err: any) => {
  if (err instanceof BankApiError) return res.status(err.status >= 500 ? 502 : 400).json({ error: err.message });
  console.error('Pankkiyhteysvirhe:', err);
  return res.status(500).json({ error: 'Pankkiyhteyden käsittely epäonnistui' });
};

const notConfigured = (res: Response) => res.status(503).json({
  error: 'Pankkiyhteyttä ei ole otettu käyttöön: Enable Bankingin avaintiedosto (.pem) puuttuu kansiosta apps/bank-service/salaiset',
});

const present = (c: any) => ({
  id: c.id, aspspName: c.aspspName, aspspCountry: c.aspspCountry, status: c.status, validUntil: c.validUntil,
  syncFrom: c.syncFrom, lastSyncAt: c.lastSyncAt, lastError: c.lastError, createdAt: c.createdAt,
  accounts: (c.accounts || []).map((a: any) => ({
    id: a.id, iban: a.iban, name: a.name, currency: a.currency, enabled: a.enabled, lastSyncAt: a.lastSyncAt,
    lastBookingDate: a.lastBookingDate, lastImported: a.lastImported, balance: a.balance == null ? null : Number(a.balance), balanceAt: a.balanceAt,
  })),
});

const syncing = new Set<string>();

const seenStore = (accountId: string) => ({
  filterNew: async (refs: string[]) => {
    const done = await prisma.bankSyncedTransaction.findMany({ where: { accountId, entryReference: { in: refs } }, select: { entryReference: true } });
    const doneSet = new Set(done.map((d) => d.entryReference));
    return new Set(refs.filter((r) => !doneSet.has(r)));
  },
  markSent: async (txs: { entryReference?: string; bookingDate: string }[]) => {
    await prisma.bankSyncedTransaction.createMany({
      data: txs.map((t) => ({ accountId, entryReference: t.entryReference!, bookingDate: new Date(`${t.bookingDate}T00:00:00Z`) })),
      skipDuplicates: true,
    });
  },
});

/** Synkronoi yhteyden kaikki käytössä olevat tilit. Virheet tallennetaan yhteydelle (ei heitetä). */
export const syncConnection = async (connectionId: string, client: EnableBankingClient) => {
  if (syncing.has(connectionId)) return { imported: 0, skipped: true };
  syncing.add(connectionId);
  try {
    const conn = await prisma.bankConnection.findUnique({ where: { id: connectionId }, include: { accounts: true } });
    if (!conn || conn.status !== 'ACTIVE') return { imported: 0 };
    if (conn.validUntil < new Date()) {
      await prisma.bankConnection.update({ where: { id: conn.id }, data: { status: 'EXPIRED', lastError: 'Pankkisuostumus on vanhentunut. Yhdistä tili uudelleen.' } });
      return { imported: 0, error: 'expired' };
    }
    let imported = 0;
    const errors: string[] = [];
    for (const acc of conn.accounts.filter((a) => a.enabled)) {
      try {
        const r = await syncAccount(client, {
          companyId: conn.companyId, uid: acc.uid, iban: acc.iban, syncFrom: conn.syncFrom, lastBookingDate: acc.lastBookingDate,
        }, publishBankStatementReceived, seenStore(acc.id));
        imported += r.imported;
        await prisma.bankConnectionAccount.update({
          where: { id: acc.id },
          data: {
            lastBookingDate: r.lastBookingDate, lastSyncAt: new Date(), lastImported: r.imported,
            ...(r.balance != null ? { balance: r.balance, balanceAt: new Date() } : {}),
          },
        });
        if (r.balance != null) await reportBalance(conn.companyId, acc.iban, new Date().toISOString().slice(0, 10), r.balance, 'PSD2');
      } catch (err: any) {
        errors.push(`${acc.iban || acc.name || acc.uid}: ${err.message}`);
        if (err instanceof BankApiError && (err.status === 401 || /expired|EXPIRED|revoked|REVOKED/.test(`${err.code} ${err.message}`))) {
          await prisma.bankConnection.update({ where: { id: conn.id }, data: { status: 'EXPIRED' } });
          break;
        }
      }
    }
    await prisma.bankConnection.update({
      where: { id: conn.id },
      data: { lastSyncAt: new Date(), lastError: errors.length ? errors.join('; ').slice(0, 1000) : null },
    });
    return { imported, errors };
  } finally {
    syncing.delete(connectionId);
  }
};

/** GET /bank/connections?companyId= */
export const listConnections = async (req: Request, res: Response) => {
  const { companyId } = req.query;
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  const config = loadConfig();
  const connections = await prisma.bankConnection.findMany({
    where: { companyId: String(companyId), status: { notIn: ['REVOKED', 'FAILED'] } },
    include: { accounts: { orderBy: { iban: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    configured: !!config,
    redirectUrl: config?.redirectUrl ?? process.env.ENABLE_BANKING_REDIRECT_URL ?? 'http://localhost:5173/bank-connections/callback',
    connections: connections.map(present),
  });
};

let aspspCache: { at: number; country: string; list: any[] } | null = null;
const getAspsps = async (client: EnableBankingClient, country: string) => {
  if (aspspCache && aspspCache.country === country && Date.now() - aspspCache.at < 3600_000) return aspspCache.list;
  const list = (await client.aspsps(country)).aspsps || [];
  aspspCache = { at: Date.now(), country, list };
  return list;
};

/** GET /bank/connections/aspsps?country=FI : pankit, joihin voi yhdistää. */
export const listAspsps = async (req: Request, res: Response) => {
  const client = clientFactory();
  if (!client) return notConfigured(res);
  try {
    const country = String(req.query.country || 'FI').toUpperCase().slice(0, 2);
    const list = await getAspsps(client, country);
    res.json({
      aspsps: list.map((a: any) => ({
        name: a.name, country: a.country, logo: a.logo || null, bic: a.bic || null, beta: !!a.beta,
        psuTypes: a.psu_types || [], maximumConsentValidity: a.maximum_consent_validity ?? null,
      })),
    });
  } catch (err) { fail(res, err); }
};

/** POST /bank/connections { companyId, aspspName, aspspCountry, psuType?, syncFrom? } -> { url } (ohjaa käyttäjä pankkiin) */
export const startConnection = async (req: Request, res: Response) => {
  const { companyId, aspspName, aspspCountry = 'FI', psuType = 'business', syncFrom } = req.body || {};
  if (!(await assertCompanyAccess(req, res, companyId, 'manage'))) return;
  const client = clientFactory();
  if (!client) return notConfigured(res);
  if (!aspspName) return res.status(400).json({ error: 'Valitse pankki' });
  if (!['business', 'personal'].includes(psuType)) return res.status(400).json({ error: 'Virheellinen asiakastyyppi' });
  const from = syncFrom ? new Date(`${String(syncFrom).slice(0, 10)}T00:00:00Z`) : new Date(Date.now() - 30 * 86400_000);
  if (Number.isNaN(from.getTime()) || from > new Date()) return res.status(400).json({ error: 'Virheellinen aloituspäivä' });
  try {
    const aspsp = (await getAspsps(client, String(aspspCountry))).find((a: any) => a.name === aspspName);
    if (!aspsp) return res.status(400).json({ error: `Pankkia ${aspspName} ei löydy` });
    const validUntil = consentValidUntil(aspsp.maximum_consent_validity);
    const state = randomUUID();
    const conn = await prisma.bankConnection.create({
      data: { companyId, aspspName, aspspCountry: String(aspspCountry), psuType, state, validUntil, syncFrom: from, createdBy: userId(req) },
    });
    try {
      const auth = await client.startAuth({ aspspName, aspspCountry: String(aspspCountry), validUntil, state, psuType });
      res.status(201).json({ id: conn.id, url: auth.url });
    } catch (err: any) {
      await prisma.bankConnection.update({ where: { id: conn.id }, data: { status: 'FAILED', lastError: err.message } });
      throw err;
    }
  } catch (err) { fail(res, err); }
};

/** POST /bank/connections/callback { state, code?, error?, error_description? } : paluu pankista. */
export const completeConnection = async (req: Request, res: Response) => {
  const { state, code, error, error_description: errorDescription } = req.body || {};
  if (!state || typeof state !== 'string') return res.status(400).json({ error: 'Paluutieto puuttuu (state)' });
  const conn = await prisma.bankConnection.findUnique({ where: { state } });
  if (!conn) return res.status(404).json({ error: 'Yhdistämispyyntöä ei löydy. Aloita yhdistäminen uudelleen.' });
  if (!(await assertCompanyAccess(req, res, conn.companyId, 'manage'))) return;
  if (conn.status === 'ACTIVE') {
    const full = await prisma.bankConnection.findUnique({ where: { id: conn.id }, include: { accounts: true } });
    return res.json({ companyId: conn.companyId, connection: present(full) });
  }
  if (conn.status !== 'PENDING') return res.status(409).json({ error: 'Tämä yhdistämispyyntö on jo käsitelty. Aloita uudelleen.' });
  if (Date.now() - conn.createdAt.getTime() > 3600_000) {
    await prisma.bankConnection.update({ where: { id: conn.id }, data: { status: 'FAILED', lastError: 'Yhdistäminen aikakatkaistiin' } });
    return res.status(410).json({ error: 'Yhdistämispyyntö vanheni (yli tunti). Aloita uudelleen.' });
  }
  if (error || !code) {
    const msg = `Pankkitunnistus keskeytyi${errorDescription || error ? `: ${errorDescription || error}` : ''}`;
    await prisma.bankConnection.update({ where: { id: conn.id }, data: { status: 'FAILED', lastError: msg } });
    return res.status(400).json({ error: msg, companyId: conn.companyId });
  }
  const client = clientFactory();
  if (!client) return notConfigured(res);
  try {
    // Atominen siirto: rinnakkainen paluu (esim. sivun päivitys) ei luo kahta sessiota
    const claimed = await prisma.bankConnection.updateMany({ where: { id: conn.id, status: 'PENDING', sessionId: null }, data: { sessionId: 'claiming' } });
    if (claimed.count === 0) return res.status(409).json({ error: 'Yhdistäminen on jo käynnissä' });
    let session;
    try {
      session = await client.createSession(String(code));
    } catch (err: any) {
      await prisma.bankConnection.update({ where: { id: conn.id }, data: { status: 'FAILED', sessionId: null, lastError: err.message } });
      throw err;
    }
    const validUntil = session.access?.valid_until ? new Date(session.access.valid_until) : conn.validUntil;
    await prisma.bankConnection.update({
      where: { id: conn.id },
      data: {
        sessionId: session.session_id, status: 'ACTIVE', validUntil, lastError: null,
        accounts: {
          create: (session.accounts || []).map((a) => ({
            uid: a.uid, iban: a.account_id?.iban?.replace(/\s+/g, '') || null, name: a.name || null, currency: a.currency || 'EUR',
          })),
        },
      },
    });
    audit(conn.companyId, userId(req), 'CREATE', conn.id,
      `Pankkiyhteys ${conn.aspspName} yhdistetty (${session.accounts?.length ?? 0} tiliä, voimassa ${validUntil.toISOString().slice(0, 10)} asti)`);
    const sync = await syncConnection(conn.id, client);
    const full = await prisma.bankConnection.findUnique({ where: { id: conn.id }, include: { accounts: true } });
    res.json({ companyId: conn.companyId, connection: present(full), imported: sync.imported });
  } catch (err) { fail(res, err); }
};

const loadOwned = async (req: Request, res: Response, level: 'read' | 'write' | 'manage') => {
  const conn = await prisma.bankConnection.findUnique({ where: { id: req.params.id } });
  if (!conn) { res.status(404).json({ error: 'Pankkiyhteyttä ei löydy' }); return null; }
  if (!(await assertCompanyAccess(req, res, conn.companyId, level))) return null;
  return conn;
};

/** POST /bank/connections/:id/sync : hae uudet tapahtumat nyt. */
export const syncNow = async (req: Request, res: Response) => {
  const conn = await loadOwned(req, res, 'write');
  if (!conn) return;
  if (conn.status !== 'ACTIVE') return res.status(409).json({ error: 'Yhteys ei ole voimassa. Yhdistä tili uudelleen.' });
  const client = clientFactory();
  if (!client) return notConfigured(res);
  const result = await syncConnection(conn.id, client);
  const full = await prisma.bankConnection.findUnique({ where: { id: conn.id }, include: { accounts: true } });
  res.json({ imported: result.imported, connection: present(full) });
};

/** PATCH /bank/connections/:id/accounts/:accountId { enabled } : tilin haku päälle/pois. */
export const setAccountEnabled = async (req: Request, res: Response) => {
  const conn = await loadOwned(req, res, 'manage');
  if (!conn) return;
  const enabled = Boolean(req.body?.enabled);
  const r = await prisma.bankConnectionAccount.updateMany({ where: { id: req.params.accountId, connectionId: conn.id }, data: { enabled } });
  if (!r.count) return res.status(404).json({ error: 'Tiliä ei löydy' });
  audit(conn.companyId, userId(req), 'UPDATE', conn.id, `Pankkitilin haku ${enabled ? 'otettu käyttöön' : 'poistettu käytöstä'}`);
  res.json({ ok: true });
};

/** DELETE /bank/connections/:id : peruu suostumuksen pankissa ja lopettaa haun. Kirjatut tapahtumat säilyvät. */
export const removeConnection = async (req: Request, res: Response) => {
  const conn = await loadOwned(req, res, 'manage');
  if (!conn) return;
  const client = clientFactory();
  let warning: string | undefined;
  if (client && conn.sessionId && conn.sessionId !== 'claiming' && conn.status === 'ACTIVE') {
    try { await client.deleteSession(conn.sessionId); } catch (err: any) { warning = `Suostumuksen peruminen pankissa epäonnistui: ${err.message}`; }
  }
  await prisma.bankConnection.update({ where: { id: conn.id }, data: { status: 'REVOKED' } });
  audit(conn.companyId, userId(req), 'DELETE', conn.id, `Pankkiyhteys ${conn.aspspName} poistettu`);
  res.json({ ok: true, warning });
};

/** Ajastettu haku kaikille voimassa oleville yhteyksille. */
export const startSyncScheduler = () => {
  const hours = Number(process.env.ENABLE_BANKING_SYNC_HOURS || 6);
  if (!(hours > 0)) return;
  const run = async () => {
    const client = clientFactory();
    if (!client) return;
    try {
      await prisma.bankConnection.updateMany({
        where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 3600_000) } },
        data: { status: 'FAILED', lastError: 'Yhdistäminen jäi kesken' },
      });
      const active = await prisma.bankConnection.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
      for (const c of active) {
        const r = await syncConnection(c.id, client);
        if (r.imported) console.log(`Pankkiyhteys ${c.id}: ${r.imported} tapahtumaa`);
      }
    } catch (err: any) {
      console.error('Ajastettu pankkihaku epäonnistui:', err.message);
    }
  };
  setTimeout(run, 60_000);
  setInterval(run, hours * 3600_000);
};
