import { Request, Response } from 'express';
import { prisma } from '../db';
import { assertCompanyAccess } from '../middleware/requireAuth';
import { findOpenFiscalYearId } from '../services/fiscalYearService';
import {
  FIELD_LABELS, VAT_ACCOUNTS, VAT_CODES, VAT_SETTLEMENT_TYPE, VatFields, VatPeriodLength, computeVatReturn, ilmoitinFile, isBusinessId,
  parsePeriod, periodsOfYear, settlementLines,
} from '../vat';

/** Arvonlisävero: asetukset, kausiveroilmoitus, Ilmoitin.fi-tiedosto ja ALV-tilitys (moduuli 8). */

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const handle = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('ALV-virhe:', err);
    res.status(500).json({ error: 'ALV-toiminto epäonnistui' });
  }
};
const actorOf = (req: Request): string => (req as any).user?.userId || 'system';
const companyOf = (req: Request) => String(req.query.companyId ?? req.body?.companyId ?? '');
const LENGTHS: VatPeriodLength[] = ['MONTH', 'QUARTER', 'YEAR'];

const defaults = (companyId: string) => ({
  companyId, registered: false, period: 'MONTH', deductionPercent: 100, registeredFrom: null, businessId: null, contactPhone: null,
});

export const loadVatSettings = async (companyId: string) => {
  const s = await prisma.vatSettings.findUnique({ where: { companyId } });
  return s ? { ...s, deductionPercent: Number(s.deductionPercent) } : defaults(companyId);
};

/** GET /vat/settings?companyId */
export const getSettings = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  res.json({ settings: await loadVatSettings(companyId), codes: VAT_CODES, softwareFileEnabled: !!process.env.VERO_SOFTWARE_ID });
});

/** PUT /vat/settings { companyId, registered, period, deductionPercent, registeredFrom, businessId, contactPhone } */
export const updateSettings = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'manage'))) return;
  const b = req.body ?? {};
  const period = String(b.period ?? 'MONTH');
  if (!LENGTHS.includes(period as VatPeriodLength)) throw new HttpError(400, 'Verokausi on kuukausi, neljännes tai vuosi');
  const pct = Number(String(b.deductionPercent ?? 100).replace(',', '.'));
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new HttpError(400, 'Vähennysoikeus on 0–100 %');
  const businessId = b.businessId ? String(b.businessId).trim() : null;
  if (businessId && !isBusinessId(businessId)) throw new HttpError(400, 'Y-tunnus on virheellinen (muoto 1234567-8, tarkiste)');
  const registeredFrom = b.registeredFrom ? new Date(`${String(b.registeredFrom).slice(0, 10)}T00:00:00Z`) : null;
  if (registeredFrom && Number.isNaN(registeredFrom.getTime())) throw new HttpError(400, 'Virheellinen alkupäivä');
  const data = {
    registered: Boolean(b.registered), period, deductionPercent: Math.round(pct * 100) / 100, registeredFrom, businessId,
    contactPhone: b.contactPhone ? String(b.contactPhone).slice(0, 35) : null, updatedBy: actorOf(req),
  };
  const saved = await prisma.vatSettings.upsert({ where: { companyId }, create: { companyId, ...data }, update: data });
  res.json({ settings: { ...saved, deductionPercent: Number(saved.deductionPercent) } });
});

const periodOrThrow = (key: unknown) => {
  const p = parsePeriod(String(key ?? ''));
  if (!p) throw new HttpError(400, 'Verokausi muodossa 2026-11, 2026-Q4 tai 2026');
  return p;
};

/** Kauden viennit (kirjatut ja lukitut). Luonnokset lasketaan erikseen varoitukseksi. */
const computeFor = async (companyId: string, key: string) => {
  const period = periodOrThrow(key);
  const where = { companyId, entryDate: { gte: period.start, lte: period.end } };
  const lines = await prisma.accountingLine.findMany({
    where: { entry: { ...where, status: { in: ['POSTED', 'LOCKED'] } } },
    select: { accountNumber: true, debit: true, credit: true, vatCode: true, vatAmount: true, entry: { select: { entryType: true } } },
  });
  const result = computeVatReturn(lines.map((l) => ({ ...l, entryType: l.entry.entryType })));
  const drafts = await prisma.accountingEntry.count({
    where: {
      ...where, status: 'DRAFT',
      lines: { some: { OR: [{ vatCode: { not: null } }, { accountNumber: { in: [VAT_ACCOUNTS.RECEIVABLE, VAT_ACCOUNTS.PAYABLE] } }] } },
    },
  });
  if (drafts) result.warnings.unshift(`${drafts} hyväksymätöntä vientiä sisältää arvonlisäveroa tällä kaudella. Ne eivät ole mukana ennen hyväksyntää.`);
  const settlement = await prisma.accountingEntry.findUnique({
    where: { companyId_voucherNumber: { companyId, voucherNumber: `ALV-${period.key}` } },
    select: { id: true, entryDate: true, status: true, postedAt: true },
  });
  return { period, ...result, settlement };
};

const presentFields = (f: VatFields) => (Object.keys(FIELD_LABELS) as (keyof VatFields)[])
  .map((code) => ({ code, label: FIELD_LABELS[code], amount: f[code] / 100 }));

/** GET /vat/periods?companyId&year */
export const listPeriods = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  const settings = await loadVatSettings(companyId);
  const year = Number(req.query.year) || new Date().getUTCFullYear();
  const today = new Date();
  const out = [];
  for (const key of periodsOfYear(year, settings.period as VatPeriodLength)) {
    const r = await computeFor(companyId, key);
    if (settings.registeredFrom && r.period.end < settings.registeredFrom) continue;
    out.push({
      key, label: r.period.label, start: r.period.start, end: r.period.end, due: r.period.due,
      ended: r.period.end < today, payable: r.fields[308] / 100, output: r.output / 100, deductible: r.fields[307] / 100,
      settled: !!r.settlement, warnings: r.warnings.length,
    });
  }
  res.json({ year, settings, periods: out });
});

/** GET /vat/return?companyId&period */
export const getReturn = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  const r = await computeFor(companyId, String(req.query.period));
  res.json({
    period: { key: r.period.key, label: r.period.label, start: r.period.start, end: r.period.end, due: r.period.due, length: r.period.length },
    fields: presentFields(r.fields), payable: r.fields[308] / 100, warnings: r.warnings, settlement: r.settlement,
    preview: settlementLines(r.fields, r.period.label),
  });
});

/** GET /vat/return/file?companyId&period : Ilmoitin.fi-tiedosto (VSRALVKV). */
export const getReturnFile = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  const softwareId = process.env.VERO_SOFTWARE_ID;
  if (!softwareId) {
    throw new HttpError(409, 'Ilmoitin.fi-tiedosto vaatii ohjelmiston tunnisteen (VERO_SOFTWARE_ID = ohjelmistotoimittajan Y-tunnus_tunniste). '
      + 'Siihen asti luvut syötetään OmaVerossa käsin.');
  }
  const settings = await loadVatSettings(companyId);
  if (!settings.businessId) throw new HttpError(400, 'Yhtiön Y-tunnus puuttuu ALV-asetuksista');
  const r = await computeFor(companyId, String(req.query.period));
  const file = ilmoitinFile({
    fields: r.fields, period: r.period, businessId: settings.businessId, softwareId,
    softwareName: process.env.VERO_SOFTWARE_NAME || 'AI Accountant', phone: settings.contactPhone,
  });
  res.setHeader('Content-Type', 'text/plain; charset=iso-8859-1');
  res.setHeader('Content-Disposition', `attachment; filename="ALV_${settings.businessId}_${r.period.key}.txt"`);
  res.send(Buffer.from(file, 'latin1'));
});

/** POST /vat/settle { companyId, period } : ALV-tilitysvienti kauden päättymispäivälle. */
export const settle = handle(async (req, res) => {
  const companyId = companyOf(req);
  if (!(await assertCompanyAccess(req, res, companyId, 'manage'))) return;
  const r = await computeFor(companyId, String(req.body?.period));
  if (r.settlement) throw new HttpError(409, `Kausi ${r.period.label} on jo tilitetty`);
  if (r.period.end >= new Date()) throw new HttpError(400, `Kausi ${r.period.label} ei ole vielä päättynyt`);
  const lines = settlementLines(r.fields, r.period.label);
  if (!lines.length) throw new HttpError(400, 'Kaudella ei ole tilitettävää arvonlisäveroa');
  const fiscalYearId = await findOpenFiscalYearId(companyId, r.period.end);
  if (!fiscalYearId) throw new HttpError(409, 'Kauden päättymispäivälle ei ole avointa tilikautta');
  const entry = await prisma.accountingEntry.create({
    data: {
      companyId, fiscalYearId, entryDate: r.period.end, voucherNumber: `ALV-${r.period.key}`, entryType: VAT_SETTLEMENT_TYPE,
      description: `ALV-tilitys ${r.period.label}`, status: 'POSTED', postedBy: actorOf(req), postedAt: new Date(), createdBy: actorOf(req),
      lines: { create: lines.map((l) => ({ ...l, companyId, vatCode: null, vatAmount: null })) },
    },
    include: { lines: true },
  });
  res.status(201).json({ entry, payable: r.fields[308] / 100 });
});
