import { Request, Response } from 'express';
import { EntryStatus } from '../../prisma/client';
import { prisma } from '../db';
import { AccessLevel, assertCompanyAccess } from '../middleware/requireAuth';
import { form4 } from '../taxReturn4';

/**
 * Tilinpäätöspaketin tekstit (toimintakertomus, liitetiedot, tase-erittelyt, allekirjoittajat) ja talousarvio.
 * Laskelmat ja PDF:t tekee reporting-service; täällä säilytetään vain käyttäjän kirjoittamat osat.
 */

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const handle = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('Tilinpäätöspakettivirhe:', err);
    res.status(500).json({ error: 'Toiminto epäonnistui' });
  }
};

const DAY = 86_400_000;
const MAX_TEXT = 20_000;
const actorOf = (req: Request): string => (req as any).user?.userId || 'system';

const loadFiscalYear = async (req: Request, res: Response, level: AccessLevel) => {
  const fy = await prisma.fiscalYear.findUnique({ where: { id: req.params.id } });
  if (!fy) throw new HttpError(404, 'Tilikautta ei löydy');
  if (!(await assertCompanyAccess(req, res, fy.companyId, level))) return null;
  return fy;
};

/** { avain: teksti } -kenttä: vain merkkijonoja, tyhjät pois (tyhjä = automaattinen teksti). */
/** Toimintakertomuksen ja liitetietojen osiot (reporting-service closing.py: REPORT_SECTIONS, NOTE_SECTIONS). */
export const REPORT_KEYS = ['general', 'property', 'repairs', 'maintenance_plan', 'budget', 'finance', 'events', 'proposal'];
export const NOTE_KEYS = ['principles', 'fixed_assets', 'equity', 'loans', 'collateral', 'personnel', 'books'];

export const cleanTextMap = (value: unknown, field: string, allowed?: string[]): Record<string, string> | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, `${field}: odotettiin objektia`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9_:.-]{1,40}$/.test(k)) throw new HttpError(400, `${field}: virheellinen avain ${k}`);
    // Tuntematon osio tallentui aiemmin hiljaa, mutta ei näkynyt tilinpäätöksessä
    if (allowed && !allowed.includes(k)) throw new HttpError(400, `${field}: tuntematon osio ${k} (sallitut: ${allowed.join(', ')})`);
    if (v === null || v === undefined || v === '') continue;
    if (typeof v !== 'string') throw new HttpError(400, `${field}.${k}: odotettiin tekstiä`);
    if (v.length > MAX_TEXT) throw new HttpError(400, `${field}.${k}: teksti on liian pitkä`);
    if (v.trim()) out[k] = v.replace(/\r\n/g, '\n');
  }
  return out;
};

const cleanSigners = (value: unknown) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 12) throw new HttpError(400, 'Allekirjoittajat: enintään 12 henkilöä');
  return value
    .map((s: any) => ({ name: String(s?.name ?? '').trim().slice(0, 100), role: String(s?.role ?? '').trim().slice(0, 60) }))
    .filter((s) => s.name);
};

const packageJson = (fy: any, p: any) => ({
  fiscalYear: fy,
  report: (p?.report as Record<string, string>) ?? {},
  notes: (p?.notes as Record<string, string>) ?? {},
  balanceNotes: (p?.balanceNotes as Record<string, string>) ?? {},
  signers: (p?.signers as { name: string; role: string }[]) ?? [],
  signPlace: p?.signPlace ?? null,
  signDate: p?.signDate ?? null,
  auditorName: p?.auditorName ?? null,
  auditorKind: p?.auditorKind ?? null,
  signedAt: p?.signedAt ?? null,
  updatedAt: p?.updatedAt ?? null,
});

export const getClosingPackage = handle(async (req, res) => {
  const fy = await loadFiscalYear(req, res, 'read');
  if (!fy) return;
  const p = await prisma.closingPackage.findUnique({ where: { fiscalYearId: fy.id } });
  res.json(packageJson(fy, p));
});

export const updateClosingPackage = handle(async (req, res) => {
  const fy = await loadFiscalYear(req, res, 'write');
  if (!fy) return;
  const existing = await prisma.closingPackage.findUnique({ where: { fiscalYearId: fy.id } });
  const body = req.body ?? {};

  // Allekirjoitetun tilinpäätöksen tekstejä ei muuteta; lukituksen voi avata vain isännöitsijä
  if (body.signed === false) {
    if ((req as any).companyRole !== 'MANAGER') throw new HttpError(403, 'Vain isännöitsijä voi avata allekirjoitetun tilinpäätöksen');
  } else if (existing?.signedAt) {
    throw new HttpError(409, 'Tilinpäätös on merkitty allekirjoitetuksi. Avaa lukitus ennen muutoksia.');
  }

  const data: Record<string, unknown> = { updatedBy: actorOf(req) };
  const report = cleanTextMap(body.report, 'report', REPORT_KEYS);
  const notes = cleanTextMap(body.notes, 'notes', NOTE_KEYS);
  const balanceNotes = cleanTextMap(body.balanceNotes, 'balanceNotes');
  const signers = cleanSigners(body.signers);
  if (report) data.report = report;
  if (notes) data.notes = notes;
  if (balanceNotes) data.balanceNotes = balanceNotes;
  if (signers) data.signers = signers;
  if (body.signPlace !== undefined) data.signPlace = body.signPlace ? String(body.signPlace).trim().slice(0, 80) : null;
  if (body.signDate !== undefined) {
    if (body.signDate && Number.isNaN(new Date(body.signDate).getTime())) throw new HttpError(400, 'Päiväys on virheellinen');
    data.signDate = body.signDate ? new Date(body.signDate) : null;
  }
  if (body.auditorName !== undefined) data.auditorName = body.auditorName ? String(body.auditorName).trim().slice(0, 100) : null;
  if (body.auditorKind !== undefined) {
    if (body.auditorKind && !['AUDITOR', 'INSPECTOR'].includes(body.auditorKind)) throw new HttpError(400, 'auditorKind: AUDITOR tai INSPECTOR');
    data.auditorKind = body.auditorKind || null;
  }
  if (body.signed === true) {
    if (fy.status !== 'CLOSED') throw new HttpError(409, 'Sulje tilikausi ennen kuin merkitset tilinpäätöksen allekirjoitetuksi');
    const names = (signers ?? (existing?.signers as any[]) ?? []);
    if (!names.length) throw new HttpError(400, 'Lisää allekirjoittajat ennen allekirjoitetuksi merkitsemistä');
    data.signedAt = new Date();
  } else if (body.signed === false) {
    data.signedAt = null;
  }

  const saved = await prisma.closingPackage.upsert({
    where: { fiscalYearId: fy.id },
    create: { fiscalYearId: fy.id, companyId: fy.companyId, ...data },
    update: data,
  });
  res.json(packageJson(fy, saved));
});

/** Tuloslaskelmatilien toteuma luonnollisella etumerkillä (tuotot ja kulut positiivisina), euroina. */
export const naturalAmount = (accountNumber: string, debitMinusCreditCents: number) =>
  (Number(accountNumber) < 4000 ? -debitMinusCreditCents : debitMinusCreditCents) / 100 + 0;

const actualsFor = async (companyId: string, fy: { startDate: Date; endDate: Date } | null) => {
  if (!fy) return {} as Record<string, number>;
  const lines = await prisma.accountingLine.findMany({
    where: {
      companyId,
      accountNumber: { gte: '3000' },
      entry: {
        entryDate: { gte: fy.startDate, lt: new Date(fy.endDate.getTime() + DAY) },
        status: { in: [EntryStatus.POSTED, EntryStatus.LOCKED] },
        entryType: { not: 'CLOSING' },
      },
    },
    select: { accountNumber: true, debit: true, credit: true },
  });
  const cents: Record<string, number> = {};
  for (const l of lines) {
    cents[l.accountNumber] = (cents[l.accountNumber] ?? 0) + Math.round(Number(l.debit) * 100) - Math.round(Number(l.credit) * 100);
  }
  return Object.fromEntries(Object.entries(cents).map(([acc, c]) => [acc, naturalAmount(acc, c)]));
};

/** GET /fiscal-years/:id/tax-return : veroilmoitus 4 (asunto- ja kiinteistöyhteisö) kirjanpidosta. */
export const getTaxReturn = handle(async (req, res) => {
  const fy = await loadFiscalYear(req, res, 'read');
  if (!fy) return;
  const actual = await actualsFor(fy.companyId, fy);
  const assets = await prisma.fixedAsset.count({ where: { companyId: fy.companyId, isActive: true } });
  const result = form4(actual);
  if (assets && result.rows.find((r) => r.key === 'poistot')?.books) {
    result.warnings.push('Poistot: täytä lomake 62 (poistoerittely) ja varmista, että Verotus-sarakkeen poisto ei ylitä verotuksen enimmäismäärää.');
  }
  const due = new Date(Date.UTC(fy.endDate.getUTCFullYear(), fy.endDate.getUTCMonth() + 4, 1));
  res.json({ fiscalYear: { id: fy.id, startDate: fy.startDate, endDate: fy.endDate, status: fy.status }, ...result, dueHint: due });
});

export const getBudget = handle(async (req, res) => {
  const fy = await loadFiscalYear(req, res, 'read');
  if (!fy) return;
  const prevFy = await prisma.fiscalYear.findFirst({
    where: { companyId: fy.companyId, startDate: { lt: fy.startDate } },
    orderBy: { startDate: 'desc' },
  });
  const [lines, accounts, actual, previous] = await Promise.all([
    prisma.budgetLine.findMany({ where: { fiscalYearId: fy.id }, orderBy: { accountNumber: 'asc' } }),
    prisma.account.findMany({
      where: { companyId: fy.companyId, accountNumber: { gte: '3000' } },
      select: { accountNumber: true, accountName: true, isActive: true },
      orderBy: { accountNumber: 'asc' },
    }),
    actualsFor(fy.companyId, fy),
    actualsFor(fy.companyId, prevFy),
  ]);
  res.json({
    fiscalYear: fy,
    previousFiscalYear: prevFy,
    lines: lines.map((l) => ({ accountNumber: l.accountNumber, amount: Number(l.amount) })),
    accounts,
    actual,
    previous,
  });
});

/** Korvaa tilikauden talousarvion. Nolla tai tyhjä summa poistaa rivin. */
export const updateBudget = handle(async (req, res) => {
  const fy = await loadFiscalYear(req, res, 'write');
  if (!fy) return;
  const input = req.body?.lines;
  if (!Array.isArray(input) || input.length > 500) throw new HttpError(400, 'lines: lista tilejä ja summia');
  const accounts = new Set((await prisma.account.findMany({ where: { companyId: fy.companyId }, select: { accountNumber: true } })).map((a) => a.accountNumber));
  const rows = new Map<string, number>();
  for (const l of input) {
    const acc = String(l?.accountNumber ?? '');
    const amount = Math.round(Number(l?.amount) * 100) / 100;
    if (!/^\d{4}$/.test(acc) || acc < '3000') throw new HttpError(400, `Tili ${acc}: talousarvioon kuuluvat tuotto- ja kulutilit (3000–9999)`);
    if (!accounts.has(acc)) throw new HttpError(400, `Tiliä ${acc} ei ole yhtiön tilikartassa`);
    if (!Number.isFinite(amount)) throw new HttpError(400, `Tili ${acc}: summa on virheellinen`);
    if (amount !== 0) rows.set(acc, amount);
  }
  await prisma.$transaction([
    prisma.budgetLine.deleteMany({ where: { fiscalYearId: fy.id } }),
    prisma.budgetLine.createMany({
      data: [...rows].map(([accountNumber, amount]) => ({ companyId: fy.companyId, fiscalYearId: fy.id, accountNumber, amount })),
    }),
  ]);
  res.json({ saved: rows.size });
});
