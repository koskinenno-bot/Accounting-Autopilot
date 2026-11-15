import { Request, Response } from 'express';
import { EntryStatus } from '../../prisma/client';
import { prisma } from '../db';
import { assertCompanyAccess } from '../middleware/requireAuth';
import { buildOpeningLines } from '../closing';
import { aggregate, migrationLines, openingRowsFrom, parseTrialBalance, suggestTarget, totals } from '../migration';
import type { SignMode } from '../migration';

/**
 * Siirto vanhasta järjestelmästä: saldoluettelon esikatselu, tilien mäppäys, vertailuvuoden kirjaus
 * (suljettu tilikausi) ja seuraavan tilikauden avaustase. Ks. src/migration.ts.
 */

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const handle = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.code === 'P2002') return res.status(409).json({ error: 'Siirto on jo tehty (sama tositenumero)' });
    console.error('Siirtovirhe:', err);
    res.status(500).json({ error: 'Toiminto epäonnistui' });
  }
};

const DAY = 86_400_000;
const MIGRATION_TYPE = 'MIGRATION';
const actorOf = (req: Request): string => (req as any).user?.userId || 'system';
const day = (d: Date) => d.toISOString().slice(0, 10);
const signModeOf = (v: unknown): SignMode => (v === 'NATURAL' ? 'NATURAL' : 'DEBIT_POSITIVE');

const loadContext = async (companyId: string) => {
  const [accounts, saved, years] = await Promise.all([
    prisma.account.findMany({ where: { companyId }, select: { accountNumber: true, accountName: true, isActive: true }, orderBy: { accountNumber: 'asc' } }),
    prisma.accountMapping.findMany({ where: { companyId } }),
    prisma.fiscalYear.findMany({ where: { companyId }, orderBy: { startDate: 'asc' } }),
  ]);
  return { accounts, saved: new Map(saved.map((m) => [m.sourceAccount, m.targetAccount])), years };
};

/** Tehdyt siirrot: vertailukausi, tosite ja tilien määrä. */
const migratedYears = async (companyId: string) => {
  const entries = await prisma.accountingEntry.findMany({
    where: { companyId, entryType: MIGRATION_TYPE },
    select: { fiscalYearId: true, voucherNumber: true, createdAt: true, fiscalYear: { select: { startDate: true, endDate: true } }, _count: { select: { lines: true } } },
    orderBy: { entryDate: 'asc' },
  });
  return entries.map((e) => ({
    fiscalYearId: e.fiscalYearId, voucherNumber: e.voucherNumber, createdAt: e.createdAt,
    startDate: e.fiscalYear?.startDate ?? null, endDate: e.fiscalYear?.endDate ?? null, accounts: e._count.lines,
  }));
};

export const listMigrations = handle(async (req, res) => {
  const companyId = String(req.query.companyId ?? '');
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  const mappings = await prisma.accountMapping.findMany({ where: { companyId }, orderBy: { sourceAccount: 'asc' } });
  res.json({ migrated: await migratedYears(companyId), mappings: mappings.length });
});

export const previewMigration = handle(async (req, res) => {
  const { companyId, text, signMode } = req.body ?? {};
  if (!(await assertCompanyAccess(req, res, companyId, 'write'))) return;
  if (typeof text !== 'string' || text.length > 500_000) throw new HttpError(400, 'Liitä saldoluettelo tekstinä (enintään 500 kt)');
  const parsed = parseTrialBalance(text, signModeOf(signMode));
  const { accounts, saved, years } = await loadContext(companyId);
  const names = new Map(accounts.map((a) => [a.accountNumber, a.accountName]));
  const rows = parsed.rows.map((r) => {
    const s = suggestTarget(r, accounts, saved);
    return { ...r, amount: r.cents / 100, targetAccount: s.targetAccount, targetName: s.targetAccount ? names.get(s.targetAccount) ?? null : null, how: s.how };
  });
  const sum = parsed.rows.reduce((t, r) => ({ debit: t.debit + Math.max(r.cents, 0), credit: t.credit + Math.max(-r.cents, 0) }), { debit: 0, credit: 0 });
  const result = -parsed.rows.filter((r) => Number(r.sourceAccount[0]) >= 3).reduce((t, r) => t + r.cents, 0);
  const first = years[0];
  // Ehdotettu vertailukausi: ensimmäistä tilikautta edeltävä 12 kk
  const suggestedPeriod = first ? {
    startDate: day(new Date(Date.UTC(first.startDate.getUTCFullYear() - 1, first.startDate.getUTCMonth(), first.startDate.getUTCDate()))),
    endDate: day(new Date(first.startDate.getTime() - DAY)),
  } : null;
  res.json({
    rows: rows.map(({ cents: _c, ...r }) => r),
    errors: parsed.errors,
    warnings: parsed.warnings,
    totals: { debit: sum.debit / 100, credit: sum.credit / 100, difference: (sum.debit - sum.credit) / 100, result: result / 100 },
    accounts,
    suggestedPeriod,
    migrated: await migratedYears(companyId),
  });
});

/** Vertailuvuoden kirjaus ja avaustase. Vain isännöitsijä. */
export const importMigration = handle(async (req, res) => {
  const { companyId, text, signMode, mapping, startDate, endDate, createOpening } = req.body ?? {};
  if (!(await assertCompanyAccess(req, res, companyId, 'manage'))) return;
  if (typeof text !== 'string') throw new HttpError(400, 'Saldoluettelo puuttuu');
  if (!mapping || typeof mapping !== 'object') throw new HttpError(400, 'Tilien mäppäys puuttuu');
  const start = new Date(String(startDate));
  const end = new Date(String(endDate));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new HttpError(400, 'Anna vertailukauden alku- ja loppupäivä');
  if (end.getTime() - start.getTime() > 548 * DAY) throw new HttpError(400, 'Tilikausi voi olla enintään 18 kuukautta');

  const parsed = parseTrialBalance(text, signModeOf(signMode));
  if (parsed.errors.length) throw new HttpError(400, parsed.errors.slice(0, 3).join('; '));
  const { accounts, years } = await loadContext(companyId);
  const known = new Set(accounts.map((a) => a.accountNumber));
  const map: Record<string, string> = {};
  for (const r of parsed.rows) {
    const t = String((mapping as Record<string, unknown>)[r.sourceAccount] ?? '');
    if (t && !known.has(t)) throw new HttpError(400, `Kohdetiliä ${t} ei ole yhtiön tilikartassa`);
    if (t) map[r.sourceAccount] = t;
  }
  let balances: Map<string, number>;
  let lines;
  try {
    balances = aggregate(parsed.rows, map);
    lines = migrationLines(balances);
  } catch (err: any) {
    throw new HttpError(400, err.message);
  }
  if (lines.length < 2) throw new HttpError(400, 'Saldoluettelossa on oltava vähintään kaksi tiliä');

  if (years.some((y) => y.startDate <= end && y.endDate >= start)) throw new HttpError(409, 'Kausi menee päällekkäin olemassa olevan tilikauden kanssa');
  const first = years[0];
  if (first && end >= first.startDate) throw new HttpError(409, 'Vertailukauden on päätyttävä ennen yhtiön ensimmäistä tilikautta');
  const next = years.find((y) => day(y.startDate) === day(new Date(end.getTime() + DAY)));
  let openingLines = null;
  if (createOpening) {
    if (!next) throw new HttpError(409, 'Avaustaseelle ei löydy tilikautta, joka alkaa vertailukauden jälkeisenä päivänä');
    if (next.status !== 'OPEN') throw new HttpError(409, 'Seuraava tilikausi on suljettu');
    const hasOpening = await prisma.accountingEntry.count({ where: { companyId, fiscalYearId: next.id, entryType: 'OPENING' } });
    if (hasOpening) throw new HttpError(409, 'Seuraavalle tilikaudelle on jo kirjattu avaussaldot');
    try {
      openingLines = buildOpeningLines(openingRowsFrom(balances));
    } catch (err: any) {
      throw new HttpError(400, `Avaustase: ${err.message}`);
    }
  }

  const actor = actorOf(req);
  const nameOf = new Map(parsed.rows.map((r) => [r.sourceAccount, r.sourceName]));
  const result = await prisma.$transaction(async (tx) => {
    for (const [sourceAccount, targetAccount] of Object.entries(map)) {
      await tx.accountMapping.upsert({
        where: { companyId_sourceAccount: { companyId, sourceAccount } },
        create: { companyId, sourceAccount, sourceName: nameOf.get(sourceAccount) || null, targetAccount },
        update: { sourceName: nameOf.get(sourceAccount) || null, targetAccount },
      });
    }
    const fy = await tx.fiscalYear.create({
      data: { companyId, startDate: start, endDate: end, status: 'CLOSED', description: 'Siirretty vanhasta järjestelmästä (vertailutiedot)' },
    });
    const now = new Date();
    const entry = await tx.accountingEntry.create({
      data: {
        companyId, fiscalYearId: fy.id, entryDate: end, voucherNumber: `SIIRTO-${end.getUTCFullYear()}`,
        description: `Saldot vanhasta järjestelmästä ${day(start)}–${day(end)}`, entryType: MIGRATION_TYPE,
        status: EntryStatus.LOCKED, createdBy: actor, postedBy: actor, postedAt: now, lockedAt: now,
        lines: { create: lines.map((l) => ({ ...l, companyId })) },
      },
    });
    let opening = null;
    if (openingLines && next) {
      opening = await tx.accountingEntry.create({
        data: {
          companyId, fiscalYearId: next.id, entryDate: next.startDate, voucherNumber: `AVAUS-${next.startDate.getUTCFullYear()}`,
          description: `Avaava tase ${day(next.startDate)} (siirto vanhasta järjestelmästä)`, entryType: 'OPENING',
          status: EntryStatus.POSTED, createdBy: actor, postedBy: actor, postedAt: now,
          lines: { create: openingLines.map((l) => ({ ...l, companyId })) },
        },
      });
    }
    return { fiscalYear: fy, entryId: entry.id, openingEntryId: opening?.id ?? null };
  });
  const t = totals(balances);
  res.status(201).json({ ...result, lines: lines.length, result: t.result / 100, mappings: Object.keys(map).length });
});

/** Siirron peruminen (esim. väärä mäppäys): vertailukausi ja siirron avaustase poistetaan. Vain isännöitsijä. */
export const undoMigration = handle(async (req, res) => {
  const fy = await prisma.fiscalYear.findUnique({ where: { id: req.params.fiscalYearId } });
  if (!fy) throw new HttpError(404, 'Tilikautta ei löydy');
  if (!(await assertCompanyAccess(req, res, fy.companyId, 'manage'))) return;
  const entries = await prisma.accountingEntry.findMany({ where: { fiscalYearId: fy.id }, select: { entryType: true } });
  if (!entries.length || entries.some((e) => e.entryType !== MIGRATION_TYPE)) {
    throw new HttpError(409, 'Tilikaudella on muita kuin siirtokirjauksia, joten sitä ei voi perua');
  }
  const next = await prisma.fiscalYear.findFirst({ where: { companyId: fy.companyId, startDate: new Date(fy.endDate.getTime() + DAY) } });
  if (next && next.status !== 'OPEN') throw new HttpError(409, 'Seuraava tilikausi on jo suljettu');
  await prisma.$transaction(async (tx) => {
    if (next) {
      await tx.accountingEntry.deleteMany({
        where: { fiscalYearId: next.id, entryType: 'OPENING', description: { contains: 'siirto vanhasta järjestelmästä' } },
      });
    }
    await tx.accountingEntry.deleteMany({ where: { fiscalYearId: fy.id, entryType: MIGRATION_TYPE } });
    await tx.closingPackage.deleteMany({ where: { fiscalYearId: fy.id } });
    await tx.budgetLine.deleteMany({ where: { fiscalYearId: fy.id } });
    await tx.fiscalYear.delete({ where: { id: fy.id } });
  });
  res.json({ ok: true });
});
