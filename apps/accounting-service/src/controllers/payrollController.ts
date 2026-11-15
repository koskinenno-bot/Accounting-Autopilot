import { Request, Response } from 'express';
import { prisma } from '../db';
import { assertCompanyAccess } from '../middleware/requireAuth';
import { findOpenFiscalYearId } from '../services/fiscalYearService';
import {
  AGE_LIMITS, DEFAULT_RATES, INCOME_TYPES, IncomeType, NO_TAX_CARD_PERCENT, PayItem, PayrollRates, Payslip, RATES_YEAR,
  computePayslip, contractReportDue, contractsForMonth, employerPaymentDue, employerReportDue, isIncomeType, maskHetu,
  parseHetu, payrollLines, sumSlips, wageReportDue,
} from '../payroll';

/** Palkat, tulorekisteri ja rakentamisen urakkatiedot (moduuli 9). */

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const handle = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('Palkkavirhe:', err);
    res.status(500).json({ error: 'Palkkatoiminto epäonnistui' });
  }
};
const actorOf = (req: Request): string => (req as any).user?.userId || 'system';
const companyOf = (req: Request) => String(req.query.companyId ?? req.body?.companyId ?? '');
const num = (v: unknown) => Number(String(v ?? '').replace(',', '.').replace(/\s/g, ''));
const optNum = (v: unknown, label: string, max = 100): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = num(v);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new HttpError(400, `${label}: virheellinen arvo`);
  return Math.round(n * 100) / 100;
};
const day = (v: unknown, label: string) => {
  const d = new Date(`${String(v ?? '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label}: virheellinen päivämäärä`);
  return d;
};
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

// ---------------------------------------------------------------- asetukset

const RATE_KEYS = ['tyelTotal', 'tyelEmployee', 'unemploymentEmployer', 'unemploymentEmployee', 'healthEmployer', 'accident'] as const;

const loadSettings = async (companyId: string) => {
  const s = await prisma.payrollSettings.findUnique({ where: { companyId } });
  const rates = Object.fromEntries(RATE_KEYS.map((k) => [k, s ? Number(s[k]) : DEFAULT_RATES[k]])) as unknown as PayrollRates;
  return { rates, tyelInsurer: s?.tyelInsurer ?? null, tyelPolicy: s?.tyelPolicy ?? null, saved: !!s };
};

/** GET /payroll/settings?companyId */
export const getSettings = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  res.json({
    settings: await loadSettings(companyId), defaults: DEFAULT_RATES, ratesYear: RATES_YEAR, noTaxCardPercent: NO_TAX_CARD_PERCENT,
    incomeTypes: Object.entries(INCOME_TYPES).map(([code, t]) => ({ code, label: t.label, insurance: t.insurance })),
    ageLimits: AGE_LIMITS,
  });
});

/** PUT /payroll/settings { companyId, tyelTotal, ..., tyelInsurer, tyelPolicy } */
export const updateSettings = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'manage'))) return;
  const b = req.body ?? {};
  const data: any = { updatedBy: actorOf(req) };
  for (const k of RATE_KEYS) data[k] = optNum(b[k], k, 50) ?? DEFAULT_RATES[k];
  if (data.tyelEmployee > data.tyelTotal) throw new HttpError(400, 'Työntekijän TyEL-osuus ei voi ylittää kokonaismaksua');
  data.tyelInsurer = b.tyelInsurer ? String(b.tyelInsurer).trim().slice(0, 100) : null;
  data.tyelPolicy = b.tyelPolicy ? String(b.tyelPolicy).trim().slice(0, 40) : null;
  await prisma.payrollSettings.upsert({ where: { companyId }, create: { companyId, ...data }, update: data });
  res.json({ settings: await loadSettings(companyId) });
});

// ---------------------------------------------------------------- palkansaajat

const presentPayee = (p: any) => ({
  id: p.id, name: p.name, hetu: maskHetu(p.hetu), hasHetu: !!p.hetu, iban: p.iban, role: p.role,
  taxPercent: p.taxPercent === null ? null : Number(p.taxPercent),
  taxAdditionalPercent: p.taxAdditionalPercent === null ? null : Number(p.taxAdditionalPercent),
  taxIncomeLimit: p.taxIncomeLimit === null ? null : Number(p.taxIncomeLimit),
  taxCardYear: p.taxCardYear, defaultIncomeType: p.defaultIncomeType,
  defaultAmount: p.defaultAmount === null ? null : Number(p.defaultAmount), isActive: p.isActive,
});

const payeeData = (b: any, partial: boolean) => {
  const data: any = {};
  if (!partial || b.name !== undefined) {
    const name = String(b.name ?? '').trim();
    if (!name) throw new HttpError(400, 'Nimi puuttuu');
    data.name = name.slice(0, 100);
  }
  // Henkilötunnus: tyhjä merkkijono poistaa, puuttuva kenttä säilyttää (palautetaan aina peitettynä).
  if (b.hetu !== undefined) {
    const h = String(b.hetu ?? '').trim().toUpperCase();
    if (h && !parseHetu(h)) throw new HttpError(400, 'Henkilötunnus on virheellinen (tarkiste tai päivämäärä)');
    data.hetu = h || null;
  }
  if (b.iban !== undefined) data.iban = b.iban ? String(b.iban).replace(/\s/g, '').toUpperCase().slice(0, 34) : null;
  if (b.role !== undefined) data.role = b.role ? String(b.role).trim().slice(0, 60) : null;
  if (b.taxPercent !== undefined) data.taxPercent = optNum(b.taxPercent, 'Pidätysprosentti');
  if (b.taxAdditionalPercent !== undefined) data.taxAdditionalPercent = optNum(b.taxAdditionalPercent, 'Lisäprosentti');
  if (b.taxIncomeLimit !== undefined) data.taxIncomeLimit = optNum(b.taxIncomeLimit, 'Tuloraja', 10_000_000);
  if (b.taxCardYear !== undefined) data.taxCardYear = b.taxCardYear ? Number(b.taxCardYear) : null;
  if (b.defaultIncomeType !== undefined) {
    if (!isIncomeType(b.defaultIncomeType)) throw new HttpError(400, 'Tuntematon tulolaji');
    data.defaultIncomeType = b.defaultIncomeType;
  }
  if (b.defaultAmount !== undefined) data.defaultAmount = optNum(b.defaultAmount, 'Oletussumma', 1_000_000);
  if (b.isActive !== undefined) data.isActive = Boolean(b.isActive);
  return data;
};

/** GET /payroll/payees?companyId */
export const listPayees = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  const payees = await prisma.payee.findMany({ where: { companyId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  res.json({ payees: payees.map(presentPayee) });
});

/** POST /payroll/payees */
export const createPayee = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'write'))) return;
  const payee = await prisma.payee.create({ data: { companyId, ...payeeData(req.body ?? {}, false) } });
  res.status(201).json({ payee: presentPayee(payee) });
});

/** PATCH /payroll/payees/:id */
export const updatePayee = handle(async (req, res) => {
  const existing = await prisma.payee.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'Palkansaajaa ei löydy');
  if (!(await assertCompanyAccess(req, res, existing.companyId, 'write'))) return;
  const payee = await prisma.payee.update({ where: { id: existing.id }, data: payeeData(req.body ?? {}, true) });
  res.json({ payee: presentPayee(payee) });
});

// ---------------------------------------------------------------- palkanmaksut

interface StoredSlip extends Payslip { payeeId: string; name: string; hetu: string | null; items: PayItem[] }
interface StoredResult { slips: StoredSlip[]; totals: ReturnType<typeof sumSlips> }

const yearStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** Aiemmat kirjatut maksut samalta vuodelta: ennakonpidätyksen alainen tulo ja kuukauden TyEL-ansiot palkansaajittain. */
const priorTotals = async (companyId: string, payDate: Date, excludeRunId?: string) => {
  const runs = await prisma.payrollRun.findMany({
    where: { companyId, status: 'POSTED', payDate: { gte: yearStart(payDate), lte: payDate }, id: excludeRunId ? { not: excludeRunId } : undefined },
    select: { payDate: true, result: true },
  });
  const ytd = new Map<string, number>();
  const month = new Map<string, number>();
  const ms = monthStart(payDate);
  for (const r of runs) {
    for (const s of ((r.result as unknown as StoredResult)?.slips ?? [])) {
      ytd.set(s.payeeId, (ytd.get(s.payeeId) ?? 0) + s.gross);
      if (r.payDate >= ms) month.set(s.payeeId, (month.get(s.payeeId) ?? 0) + (s.bases?.tyel ?? 0));
    }
  }
  return { ytd, month };
};

const compute = async (run: any): Promise<StoredResult & { warnings: string[] }> => {
  const { rates } = await loadSettings(run.companyId);
  const { ytd, month } = await priorTotals(run.companyId, run.payDate, run.id);
  const byPayee = new Map<string, { payee: any; items: PayItem[] }>();
  for (const it of run.items) {
    const g = byPayee.get(it.payeeId) ?? { payee: it.payee, items: [] };
    g.items.push({ incomeType: it.incomeType as IncomeType, amount: Number(it.amount), description: it.description });
    byPayee.set(it.payeeId, g);
  }
  const warnings: string[] = [];
  const slips: StoredSlip[] = [];
  for (const [payeeId, { payee, items }] of byPayee) {
    const year = run.payDate.getUTCFullYear();
    const card = payee.taxPercent === null ? null : {
      percent: Number(payee.taxPercent),
      additionalPercent: payee.taxAdditionalPercent === null ? null : Number(payee.taxAdditionalPercent),
      incomeLimit: payee.taxIncomeLimit === null ? null : Number(payee.taxIncomeLimit),
    };
    if (card && payee.taxCardYear && payee.taxCardYear !== year) warnings.push(`${payee.name}: verokortti on vuodelle ${payee.taxCardYear}, maksupäivä vuonna ${year}.`);
    const slip = computePayslip({ name: payee.name, hetu: payee.hetu, taxCard: card }, items, rates, run.payDate, ytd.get(payeeId) ?? 0, month.get(payeeId) ?? 0);
    warnings.push(...slip.warnings);
    slips.push({ ...slip, payeeId, name: payee.name, hetu: maskHetu(payee.hetu), items });
  }
  if (run.payDate.getUTCFullYear() !== RATES_YEAR) warnings.push(`Maksuprosentit ovat vuoden ${RATES_YEAR} oletuksia. Tarkista vuoden ${run.payDate.getUTCFullYear()} prosentit asetuksista.`);
  return { slips, totals: sumSlips(slips), warnings };
};

const presentRun = (r: any) => {
  const result = r.result as StoredResult | null;
  return {
    id: r.id, number: r.number, payDate: iso(r.payDate), periodStart: iso(r.periodStart), periodEnd: iso(r.periodEnd),
    description: r.description, status: r.status, accountingEntryId: r.accountingEntryId,
    wageReportedAt: r.wageReportedAt, wageReportDue: iso(wageReportDue(r.payDate)),
    totals: result?.totals ?? null, payees: result?.slips.length ?? r.items?.length ?? 0,
  };
};

const loadRun = async (req: Request, res: Response, level: 'read' | 'write' | 'manage') => {
  const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id }, include: { items: { include: { payee: true } } } });
  if (!run) throw new HttpError(404, 'Palkanmaksua ei löydy');
  if (!(await assertCompanyAccess(req, res, run.companyId, level))) return null;
  return run;
};

/** GET /payroll/runs?companyId&year */
export const listRuns = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  const year = Number(req.query.year) || new Date().getUTCFullYear();
  const runs = await prisma.payrollRun.findMany({
    where: { companyId, payDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
    include: { items: { select: { id: true } } },
    orderBy: { payDate: 'desc' },
  });
  res.json({ year, runs: runs.map(presentRun) });
});

const parseRunBody = async (companyId: string, b: any) => {
  const payDate = day(b.payDate, 'Maksupäivä');
  const periodStart = b.periodStart ? day(b.periodStart, 'Ansaintajakson alku') : payDate;
  const periodEnd = b.periodEnd ? day(b.periodEnd, 'Ansaintajakson loppu') : payDate;
  if (periodEnd < periodStart) throw new HttpError(400, 'Ansaintajakson loppu ennen alkua');
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) throw new HttpError(400, 'Lisää vähintään yksi palkka tai palkkio');
  const payeeIds = [...new Set(items.map((i: any) => String(i.payeeId)))];
  const found = await prisma.payee.count({ where: { companyId, id: { in: payeeIds as string[] } } });
  if (found !== payeeIds.length) throw new HttpError(400, 'Tuntematon palkansaaja');
  const parsed = items.map((i: any) => {
    if (!isIncomeType(i.incomeType)) throw new HttpError(400, 'Tuntematon tulolaji');
    const amount = optNum(i.amount, 'Summa', 1_000_000);
    if (!amount) throw new HttpError(400, 'Summa puuttuu');
    return { payeeId: String(i.payeeId), incomeType: i.incomeType, amount, description: i.description ? String(i.description).slice(0, 100) : null };
  });
  const description = String(b.description ?? '').trim().slice(0, 100) || `Palkat ja palkkiot ${payDate.toISOString().slice(0, 10)}`;
  return { payDate, periodStart, periodEnd, description, items: parsed };
};

/** POST /payroll/runs { companyId, payDate, periodStart, periodEnd, description, items[] } */
export const createRun = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'write'))) return;
  const { items, ...data } = await parseRunBody(companyId, req.body ?? {});
  const last = await prisma.payrollRun.findFirst({ where: { companyId }, orderBy: { number: 'desc' }, select: { number: true } });
  const run = await prisma.payrollRun.create({
    data: { companyId, number: (last?.number ?? 0) + 1, ...data, createdBy: actorOf(req), items: { create: items } },
  });
  res.status(201).json({ run: presentRun({ ...run, items }) });
});

/** PUT /payroll/runs/:id (vain luonnos) */
export const updateRun = handle(async (req, res) => {
  const run = await loadRun(req, res, 'write');
  if (!run) return;
  if (run.status !== 'DRAFT') throw new HttpError(409, 'Kirjattua palkanmaksua ei voi muuttaa');
  const { items, ...data } = await parseRunBody(run.companyId, req.body ?? {});
  await prisma.$transaction([
    prisma.payrollItem.deleteMany({ where: { runId: run.id } }),
    prisma.payrollRun.update({ where: { id: run.id }, data: { ...data, items: { create: items } } }),
  ]);
  res.json({ ok: true });
});

/** DELETE /payroll/runs/:id (vain luonnos) */
export const deleteRun = handle(async (req, res) => {
  const run = await loadRun(req, res, 'write');
  if (!run) return;
  if (run.status !== 'DRAFT') throw new HttpError(409, 'Kirjattua palkanmaksua ei voi poistaa');
  await prisma.payrollRun.delete({ where: { id: run.id } });
  res.json({ ok: true });
});

/** GET /payroll/runs/:id : laskelma (luonnos lasketaan, kirjattu luetaan lukitusta tuloksesta). */
export const getRun = handle(async (req, res) => {
  const run = await loadRun(req, res, 'read');
  if (!run) return;
  const result = run.status === 'POSTED' && run.result
    ? { ...(run.result as unknown as StoredResult), warnings: [] as string[] }
    : await compute(run);
  res.json({
    run: presentRun({ ...run, result }),
    items: run.items.map((i) => ({ id: i.id, payeeId: i.payeeId, incomeType: i.incomeType, amount: Number(i.amount), description: i.description })),
    slips: result.slips.map((s) => ({ ...s, warnings: undefined })),
    totals: result.totals, warnings: result.warnings,
    lines: payrollLines(result.slips, run.description),
  });
});

/** POST /payroll/runs/:id/post : kirjanpitovienti maksupäivälle ja laskelman lukitus (isännöitsijä). */
export const postRun = handle(async (req, res) => {
  const run = await loadRun(req, res, 'manage');
  if (!run) return;
  if (run.status !== 'DRAFT') throw new HttpError(409, 'Palkanmaksu on jo kirjattu');
  const result = await compute(run);
  const missingHetu = result.slips.filter((s) => !s.hetu).map((s) => s.name);
  if (missingHetu.length) throw new HttpError(400, `Henkilötunnus puuttuu: ${missingHetu.join(', ')}. Tulorekisteri-ilmoitus vaatii sen.`);
  const fiscalYearId = await findOpenFiscalYearId(run.companyId, run.payDate);
  if (!fiscalYearId) throw new HttpError(409, 'Maksupäivälle ei ole avointa tilikautta');
  const lines = payrollLines(result.slips, run.description);
  const stored: StoredResult = { slips: result.slips.map((s) => ({ ...s, warnings: [] })), totals: result.totals };
  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.accountingEntry.create({
      data: {
        companyId: run.companyId, fiscalYearId, entryDate: run.payDate, voucherNumber: `PALKKA-${run.number}`, entryType: 'PAYROLL',
        description: run.description, status: 'POSTED', postedBy: actorOf(req), postedAt: new Date(), createdBy: actorOf(req),
        lines: { create: lines.map((l) => ({ ...l, companyId: run.companyId })) },
      },
    });
    await tx.payrollRun.update({
      where: { id: run.id },
      data: { status: 'POSTED', accountingEntryId: created.id, result: stored as any, postedAt: new Date(), postedBy: actorOf(req) },
    });
    return created;
  });
  res.json({ entryId: entry.id, voucherNumber: entry.voucherNumber, totals: result.totals });
});

/** POST /payroll/runs/:id/reported { reported } : palkkatietoilmoitus annettu tulorekisteriin. */
export const markRunReported = handle(async (req, res) => {
  const run = await loadRun(req, res, 'write');
  if (!run) return;
  if (run.status !== 'POSTED') throw new HttpError(409, 'Kirjaa palkanmaksu ennen ilmoitusta');
  const reported = req.body?.reported !== false;
  await prisma.payrollRun.update({
    where: { id: run.id }, data: { wageReportedAt: reported ? new Date() : null, wageReportedBy: reported ? actorOf(req) : null },
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- ilmoitukset

const monthKey = (y: number, m1: number) => `${y}-${String(m1).padStart(2, '0')}`;
const parseMonth = (v: unknown) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v ?? ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new HttpError(400, 'Kuukausi muodossa 2026-11');
  return { year: Number(m[1]), month: Number(m[2]) };
};

/** GET /payroll/reports?companyId&year : työnantajan erillisilmoitukset kuukausittain ja avoimet palkkatietoilmoitukset. */
export const getReports = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  const year = Number(req.query.year) || new Date().getUTCFullYear();
  const runs = await prisma.payrollRun.findMany({
    where: { companyId, status: 'POSTED', payDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
    orderBy: { payDate: 'asc' },
  });
  const marks = await prisma.reportMark.findMany({ where: { companyId, key: { startsWith: String(year) } } });
  const markOf = (kind: string, key: string) => marks.find((m) => m.kind === kind && m.key === key) ?? null;
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const inMonth = runs.filter((r) => r.payDate.getUTCMonth() === m - 1);
    if (!inMonth.length) continue;
    const t = sumSlips(inMonth.flatMap((r) => (r.result as unknown as StoredResult).slips));
    const healthBase = inMonth.flatMap((r) => (r.result as unknown as StoredResult).slips).reduce((s, x) => s + x.bases.health, 0);
    const key = monthKey(year, m);
    const mark = markOf('EMPLOYER', key);
    months.push({
      key, wages: t.gross / 100, healthBase: healthBase / 100, healthEmployer: t.healthEmployer / 100, withholding: t.withholding / 100,
      payable: (t.withholding + t.healthEmployer) / 100, tyel: (t.tyelEmployee + t.tyelEmployer) / 100,
      unemployment: (t.unemploymentEmployee + t.unemploymentEmployer) / 100,
      reportDue: iso(employerReportDue(year, m)), paymentDue: iso(employerPaymentDue(year, m)),
      reportedAt: mark?.reportedAt ?? null,
    });
  }
  const wageReports = runs.map((r) => ({
    ...presentRun(r),
    slips: (r.result as unknown as StoredResult).slips.map((s) => ({
      name: s.name, hetu: s.hetu, byType: Object.fromEntries(Object.entries(s.byType).map(([k, v]) => [k, (v as number) / 100])),
      withholding: s.withholding / 100, tyelEmployee: s.tyelEmployee / 100, unemploymentEmployee: s.unemploymentEmployee / 100,
      insured: { tyel: s.bases.tyel > 0, unemployment: s.bases.unemployment > 0, health: s.bases.health > 0, accident: s.bases.accident > 0 },
    })),
  }));
  res.json({ year, months, wageReports, settings: await loadSettings(companyId) });
});

const MARK_KINDS = ['EMPLOYER', 'CONTRACTS'];

/** POST /payroll/reports/mark { companyId, kind, key, reported } */
export const markReport = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'write'))) return;
  const kind = String(req.body?.kind ?? '');
  if (!MARK_KINDS.includes(kind)) throw new HttpError(400, 'Tuntematon ilmoitus');
  const { year, month } = parseMonth(req.body?.key);
  const key = monthKey(year, month);
  if (req.body?.reported === false) {
    await prisma.reportMark.deleteMany({ where: { companyId, kind, key } });
  } else {
    await prisma.reportMark.upsert({
      where: { companyId_kind_key: { companyId, kind, key } },
      create: { companyId, kind, key, reportedBy: actorOf(req) },
      update: { reportedAt: new Date(), reportedBy: actorOf(req) },
    });
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------- rakentamisen urakkatiedot

const presentContract = (k: any) => ({
  id: k.id, contractorName: k.contractorName, contractorBusinessId: k.contractorBusinessId, siteName: k.siteName,
  siteAddress: k.siteAddress, description: k.description, value: Number(k.value), billingBasis: k.billingBasis,
  startDate: iso(k.startDate), endDate: iso(k.endDate),
});

const contractData = (b: any) => {
  const contractorName = String(b.contractorName ?? '').trim();
  const contractorBusinessId = String(b.contractorBusinessId ?? '').trim();
  const siteName = String(b.siteName ?? '').trim();
  if (!contractorName || !siteName) throw new HttpError(400, 'Urakoitsija ja työmaa ovat pakollisia');
  if (!/^\d{7}-\d$/.test(contractorBusinessId)) throw new HttpError(400, 'Urakoitsijan Y-tunnus muodossa 1234567-8');
  const value = optNum(b.value, 'Sopimuksen arvo', 1_000_000_000);
  if (!value) throw new HttpError(400, 'Sopimuksen arvo (alv 0) puuttuu');
  const billingBasis = b.billingBasis === 'TUNTI' ? 'TUNTI' : 'URAKKA';
  return {
    contractorName: contractorName.slice(0, 100), contractorBusinessId, siteName: siteName.slice(0, 100),
    siteAddress: b.siteAddress ? String(b.siteAddress).slice(0, 200) : null, description: b.description ? String(b.description).slice(0, 200) : null,
    value, billingBasis, startDate: day(b.startDate, 'Aloituspäivä'), endDate: b.endDate ? day(b.endDate, 'Päättymispäivä') : null,
  };
};

/** GET /payroll/contracts?companyId */
export const listContracts = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  const contracts = await prisma.constructionContract.findMany({ where: { companyId }, orderBy: { startDate: 'desc' } });
  res.json({ contracts: contracts.map(presentContract) });
});

/** POST /payroll/contracts */
export const createContract = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'write'))) return;
  const k = await prisma.constructionContract.create({ data: { companyId, ...contractData(req.body ?? {}) } });
  res.status(201).json({ contract: presentContract(k) });
});

/** PUT /payroll/contracts/:id */
export const updateContract = handle(async (req, res) => {
  const existing = await prisma.constructionContract.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'Urakkaa ei löydy');
  if (!(await assertCompanyAccess(req, res, existing.companyId, 'write'))) return;
  const k = await prisma.constructionContract.update({ where: { id: existing.id }, data: contractData(req.body ?? {}) });
  res.json({ contract: presentContract(k) });
});

/** DELETE /payroll/contracts/:id */
export const deleteContract = handle(async (req, res) => {
  const existing = await prisma.constructionContract.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'Urakkaa ei löydy');
  if (!(await assertCompanyAccess(req, res, existing.companyId, 'write'))) return;
  await prisma.constructionContract.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

/** GET /payroll/contracts/report?companyId&month=2026-11 : kuukauden urakkatiedot. */
export const getContractReport = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  const { year, month } = parseMonth(req.query.month);
  const contracts = await prisma.constructionContract.findMany({ where: { companyId } });
  const ids = [...new Set(contracts.map((k) => k.contractorBusinessId))];
  const invoices = ids.length ? await prisma.purchaseInvoice.findMany({
    where: {
      companyId, supplierBusinessId: { in: ids },
      invoiceDate: { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) },
    },
    select: { supplierBusinessId: true, invoiceDate: true, totalAmount: true, vatAmount: true },
  }) : [];
  const rows = contractsForMonth(
    contracts.map((k) => ({ ...k, value: Number(k.value) })),
    invoices.map((i) => ({ ...i, totalAmount: Number(i.totalAmount), vatAmount: i.vatAmount === null ? null : Number(i.vatAmount) })),
    year, month,
  );
  const key = monthKey(year, month);
  const mark = await prisma.reportMark.findUnique({ where: { companyId_kind_key: { companyId, kind: 'CONTRACTS', key } } });
  res.json({
    month: key, due: iso(contractReportDue(year, month)), reportedAt: mark?.reportedAt ?? null,
    rows: rows.map((r) => ({ ...presentContract(r), invoiced: r.invoiced, invoiceCount: r.invoiceCount, starts: r.starts, ends: r.ends })),
  });
});
