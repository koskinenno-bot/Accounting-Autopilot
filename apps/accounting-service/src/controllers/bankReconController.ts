import { Request, Response } from 'express';
import { prisma } from '../db';
import { assertCompanyAccess } from '../middleware/requireAuth';
import { BalanceRow, CASH_RANGE, bankBalancesAt, isIban, monthEnd, normalizeIban, reconStatus } from '../bankRecon';

/** Pankkitäsmäytys: pankkien saldot vs. kirjanpidon rahatilit kuukauden lopussa. */

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const handle = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('Pankkitäsmäytysvirhe:', err);
    res.status(500).json({ error: 'Pankkitäsmäytys epäonnistui' });
  }
};
const actorOf = (req: Request): string => (req as any).user?.userId || 'system';
const companyOf = (req: Request) => String(req.query.companyId ?? req.body?.companyId ?? '');
const SOURCES = ['PSD2', 'CAMT', 'MANUAL'];
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** POST /bank-balances { companyId, iban, date, balance, source } (pankkipalvelu tai käyttäjä) */
export const saveBalance = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'write'))) return;
  const b = req.body ?? {};
  const iban = normalizeIban(b.iban);
  if (!isIban(iban)) throw new HttpError(400, 'Tilinumero (IBAN) on virheellinen');
  const date = new Date(`${String(b.date ?? '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Virheellinen päivämäärä');
  if (date > new Date()) throw new HttpError(400, 'Saldon päivä on tulevaisuudessa');
  const balance = Number(String(b.balance ?? '').replace(',', '.').replace(/\s/g, ''));
  if (!Number.isFinite(balance)) throw new HttpError(400, 'Virheellinen saldo');
  const source = SOURCES.includes(b.source) ? b.source : 'MANUAL';
  // Käyttäjä voi syöttää vain käsin; automaattiset lähteet vain palveluilta
  if (source !== 'MANUAL' && (req as any).user?.role !== 'SERVICE') throw new HttpError(403, 'Vain pankkipalvelu voi tallentaa automaattisen saldon');
  const data = { balance: Math.round(balance * 100) / 100, source, createdBy: actorOf(req) };
  const row = await prisma.bankBalance.upsert({
    where: { companyId_iban_date: { companyId, iban, date } }, create: { companyId, iban, date, ...data }, update: data,
  });
  res.status(201).json({ id: row.id, iban, date: iso(date), balance: data.balance, source });
});

/** DELETE /bank-balances/:id (vain käsin syötetty) */
export const deleteBalance = handle(async (req, res) => {
  const row = await prisma.bankBalance.findUnique({ where: { id: req.params.id } });
  if (!row) throw new HttpError(404, 'Saldoa ei löydy');
  if (!(await assertCompanyAccess(req, res, row.companyId, 'write'))) return;
  if (row.source !== 'MANUAL') throw new HttpError(409, 'Pankista haettua saldoa ei voi poistaa');
  await prisma.bankBalance.delete({ where: { id: row.id } });
  res.json({ ok: true });
});

const cashWhere = (companyId: string) => ({ companyId, accountNumber: { gte: CASH_RANGE[0], lte: CASH_RANGE[1] } });

/** Rahatilien saldo (D − K) päivään asti: kirjatut ja lukitut viennit. */
const bookBalanceAt = async (companyId: string, at: Date) => {
  const agg = await prisma.accountingLine.aggregate({
    where: { ...cashWhere(companyId), entry: { status: { in: ['POSTED', 'LOCKED'] }, entryDate: { lte: at } } },
    _sum: { debit: true, credit: true },
  });
  return Math.round((Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0)) * 100) / 100;
};

/** Hyväksymättömät rahatilin viennit päivään asti (selittävät usein eron). */
const draftsAt = async (companyId: string, at: Date) => {
  const lines = await prisma.accountingLine.findMany({
    where: { ...cashWhere(companyId), entry: { status: 'DRAFT', entryDate: { lte: at } } },
    select: { debit: true, credit: true },
  });
  return { count: lines.length, net: Math.round(lines.reduce((s, l) => s + (Number(l.debit) - Number(l.credit)) * 100, 0)) / 100 };
};

/** GET /bank-reconciliation?companyId&year */
export const getReconciliation = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  const year = Number(req.query.year) || new Date().getUTCFullYear();
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const rows = await prisma.bankBalance.findMany({ where: { companyId, date: { lte: new Date(Date.UTC(year, 11, 31)) } }, orderBy: { date: 'asc' } });
  const balances: BalanceRow[] = rows.map((r) => ({ iban: r.iban, date: r.date, balance: Number(r.balance), source: r.source }));
  const marks = await prisma.reportMark.findMany({ where: { companyId, kind: 'BANK_RECON', key: { startsWith: String(year) } } });
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const end = monthEnd(year, m);
    const at = end > today ? today : end;
    if (new Date(Date.UTC(year, m - 1, 1)) > today) break;
    const bank = bankBalancesAt(balances, at);
    const book = await bookBalanceAt(companyId, at);
    const drafts = await draftsAt(companyId, at);
    const key = `${year}-${String(m).padStart(2, '0')}`;
    const mark = marks.find((x) => x.key === key);
    months.push({
      key, date: iso(at), current: end > today, bank: bank.total, book, ...reconStatus(bank, book), drafts,
      accounts: bank.accounts.map((a) => ({ iban: a.iban, date: iso(a.date), balance: a.balance, source: a.source, stale: a.stale })),
      reconciledAt: mark?.reportedAt ?? null,
    });
  }
  res.json({
    year, range: CASH_RANGE, months: months.reverse(),
    balances: rows.slice(-50).reverse().map((r) => ({ id: r.id, iban: r.iban, date: iso(r.date), balance: Number(r.balance), source: r.source })),
  });
});

/** POST /bank-reconciliation/mark { companyId, key, reconciled } : kuukausi täsmäytetty (vain kun ero on 0). */
export const markReconciled = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'write'))) return;
  const key = String(req.body?.key ?? '');
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) throw new HttpError(400, 'Kuukausi muodossa 2026-11');
  if (req.body?.reconciled === false) {
    await prisma.reportMark.deleteMany({ where: { companyId, kind: 'BANK_RECON', key } });
    return res.json({ ok: true });
  }
  const at = monthEnd(Number(m[1]), Number(m[2]));
  const rows = await prisma.bankBalance.findMany({ where: { companyId, date: { lte: at } } });
  const bank = bankBalancesAt(rows.map((r) => ({ iban: r.iban, date: r.date, balance: Number(r.balance), source: r.source })), at);
  const { status, difference } = reconStatus(bank, await bookBalanceAt(companyId, at));
  if (status !== 'OK') throw new HttpError(409, status === 'DIFFERENCE' ? `Ero ${difference} € on selvitettävä ennen merkintää` : 'Kuukauden lopun pankkisaldo puuttuu');
  await prisma.reportMark.upsert({
    where: { companyId_kind_key: { companyId, kind: 'BANK_RECON', key } },
    create: { companyId, kind: 'BANK_RECON', key, reportedBy: actorOf(req) },
    update: { reportedAt: new Date(), reportedBy: actorOf(req) },
  });
  res.json({ ok: true });
});
