import { Request, Response } from 'express';
import { AccountType, EntryStatus } from '../../prisma/client';
import { prisma } from '../db';
import { AccessLevel, assertCompanyAccess } from '../middleware/requireAuth';
import { ACCOUNTS } from '../accounts';
import { loadVatSettings } from './vatController';
import {
  ACCRUED_EXPENSES, ACCRUED_INCOME, DEPRECIATION_ACCOUNT, balancesFromLines, buildCarryForwardLines,
  buildClosingLines, buildOpeningLines, depreciationFor, isBalanceSheetAccount, Line, OpeningRow,
} from '../closing';

const actorOf = (req: Request): string => (req as any).user?.userId || 'system';
const DAY = 86_400_000;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const handle = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.code === 'P2002') return res.status(409).json({ error: 'Vienti on jo olemassa (sama tositenumero)' });
    if (err?.code === 'P2003') return res.status(400).json({ error: 'Tiliä ei ole yhtiön tilikartassa' });
    console.error('Fiscal error:', err);
    res.status(500).json({ error: 'Toiminto epäonnistui' });
  }
};

/** Tilikausi + käyttöoikeus. */
const loadFiscalYear = async (req: Request, res: Response, level?: AccessLevel) => {
  const fy = await prisma.fiscalYear.findUnique({ where: { id: req.params.id } });
  if (!fy) throw new HttpError(404, 'Tilikautta ei löydy');
  if (!(await assertCompanyAccess(req, res, fy.companyId, level))) return null;
  return fy;
};

const yearOf = (d: Date) => d.getUTCFullYear();
/** Tilikauden viennit päivämäärän mukaan (myös luonnokset, joilta fiscalYearId puuttuu). */
const fyRange = (fy: { startDate: Date; endDate: Date }) => ({ gte: fy.startDate, lt: new Date(fy.endDate.getTime() + DAY) });

const postedLinesOf = async (companyId: string, fy: { startDate: Date; endDate: Date }, opts: { excludeClosing?: boolean } = {}) =>
  prisma.accountingLine.findMany({
    where: {
      companyId,
      entry: {
        entryDate: fyRange(fy),
        status: { in: [EntryStatus.POSTED, EntryStatus.LOCKED] },
        ...(opts.excludeClosing ? { entryType: { not: 'CLOSING' } } : {}),
      },
    },
    select: { accountNumber: true, debit: true, credit: true },
  });

const createPostedEntry = (data: {
  companyId: string; fiscalYearId: string; entryDate: Date; voucherNumber: string; description: string;
  entryType: string; lines: Line[]; actor: string; fixedAssetId?: string;
}) =>
  prisma.accountingEntry.create({
    data: {
      companyId: data.companyId,
      fiscalYearId: data.fiscalYearId,
      entryDate: data.entryDate,
      voucherNumber: data.voucherNumber,
      description: data.description,
      entryType: data.entryType,
      fixedAssetId: data.fixedAssetId,
      status: EntryStatus.POSTED,
      createdBy: data.actor,
      postedBy: data.actor,
      postedAt: new Date(),
      lines: { create: data.lines.map((l) => ({ ...l, companyId: data.companyId })) },
    },
    include: { lines: true },
  });

const accountTypeFor = (acc: string): AccountType => {
  const n = Number(acc.slice(0, 4));
  if (n < 2000) return AccountType.ASSET;
  if (n < 2400) return AccountType.EQUITY;
  return AccountType.LIABILITY;
};

// ---------------------------------------------------------------------------
// Avaussaldot
// ---------------------------------------------------------------------------

/** POST /fiscal-years/:id/opening-balances { rows: [{ accountNumber, name?, balance }] } */
export const setOpeningBalances = handle(async (req, res) => {
  // Isännöitsijän päätös: assistentti, hallitus ja tarkastajat eivät voi
  const fy = await loadFiscalYear(req, res, 'manage');
  if (!fy) return;
  if (fy.status !== 'OPEN') throw new HttpError(409, 'Tilikausi on suljettu');
  const rows: OpeningRow[] = req.body?.rows;
  let lines: Line[];
  try {
    lines = buildOpeningLines(rows);
  } catch (err: any) {
    throw new HttpError(400, err.message);
  }
  const voucherNumber = `AVAUS-${yearOf(fy.startDate)}`;
  if (await prisma.accountingEntry.findUnique({ where: { companyId_voucherNumber: { companyId: fy.companyId, voucherNumber } } })) {
    throw new HttpError(409, `Avaussaldot (${voucherNumber}) on jo kirjattu. Korjaa ne korjausviennillä.`);
  }
  // Tilikarttaan puuttuvat tasetilit luodaan, jos tiedostossa on niille nimi
  for (const row of rows) {
    const acc = String(row.accountNumber).trim();
    const exists = await prisma.account.findUnique({ where: { companyId_accountNumber: { companyId: fy.companyId, accountNumber: acc } } });
    if (!exists) {
      if (!row.name) throw new HttpError(400, `Tiliä ${acc} ei ole tilikartassa: anna tilille nimi tiedostossa`);
      await prisma.account.create({ data: { companyId: fy.companyId, accountNumber: acc, accountName: row.name, accountType: accountTypeFor(acc) } });
    }
  }
  const entry = await createPostedEntry({
    companyId: fy.companyId, fiscalYearId: fy.id, entryDate: fy.startDate, voucherNumber,
    description: `Avaava tase ${fy.startDate.toISOString().slice(0, 10)}`, entryType: 'OPENING', lines, actor: actorOf(req),
  });
  res.status(201).json(entry);
});

// ---------------------------------------------------------------------------
// Käyttöomaisuus ja poistot
// ---------------------------------------------------------------------------

export const listAssets = handle(async (req, res) => {
  res.json(await prisma.fixedAsset.findMany({ where: { companyId: req.query.companyId as string }, orderBy: { acquisitionDate: 'asc' } }));
});

export const createAsset = handle(async (req, res) => {
  const { companyId, name, accountNumber, acquisitionDate, acquisitionCost, priorDepreciation, method, rate, usefulLifeYears, manualAmount } = req.body;
  if (!name || !accountNumber || !isBalanceSheetAccount(String(accountNumber)) || Number(accountNumber) >= 2000) {
    throw new HttpError(400, 'Anna nimi ja vastaavaa-puolen tili (esim. 1010 Rakennukset)');
  }
  if (!['DECLINING', 'STRAIGHT_LINE', 'MANUAL'].includes(method)) throw new HttpError(400, 'Poistomenetelmä: DECLINING, STRAIGHT_LINE tai MANUAL');
  if (method === 'DECLINING' && !(Number(rate) > 0)) throw new HttpError(400, 'Menojäännöspoistolle anna poistoprosentti');
  if (method === 'STRAIGHT_LINE' && !(Number(usefulLifeYears) > 0)) throw new HttpError(400, 'Tasapoistolle anna pitoaika vuosina');
  if (!(Number(acquisitionCost) > 0)) throw new HttpError(400, 'Hankintameno puuttuu');
  const asset = await prisma.fixedAsset.create({
    data: {
      companyId, name, accountNumber: String(accountNumber), method,
      acquisitionDate: new Date(acquisitionDate || Date.now()),
      acquisitionCost: Number(acquisitionCost),
      priorDepreciation: Number(priorDepreciation || 0),
      rate: rate != null && rate !== '' ? Number(rate) : null,
      usefulLifeYears: usefulLifeYears ? Number(usefulLifeYears) : null,
      manualAmount: manualAmount != null && manualAmount !== '' ? Number(manualAmount) : null,
    },
  });
  res.status(201).json(asset);
});

/** Poistoehdotukset tilikaudelle: kirjanpitoarvo kauden alussa ja laskettu poisto. */
const depreciationProposals = async (fy: { id: string; companyId: string; startDate: Date; endDate: Date }) => {
  const assets = await prisma.fixedAsset.findMany({ where: { companyId: fy.companyId, isActive: true } });
  const out = [];
  for (const asset of assets) {
    const earlier = await prisma.accountingLine.aggregate({
      _sum: { credit: true },
      where: { entry: { fixedAssetId: asset.id, entryType: 'DEPRECIATION', entryDate: { lt: fy.startDate }, status: { not: 'DRAFT' } } },
    });
    const posted = await prisma.accountingEntry.findFirst({
      where: { fixedAssetId: asset.id, entryType: 'DEPRECIATION', entryDate: fyRange(fy) },
    });
    const bookValue = Number(asset.acquisitionCost) - Number(asset.priorDepreciation) - Number(earlier._sum.credit || 0);
    const amount = depreciationFor(
      { ...asset, acquisitionCost: Number(asset.acquisitionCost), rate: asset.rate ? Number(asset.rate) : null, manualAmount: asset.manualAmount ? Number(asset.manualAmount) : null },
      bookValue,
    );
    out.push({ asset, bookValueStart: Math.round(bookValue * 100) / 100, amount, postedEntryId: posted?.id ?? null });
  }
  return out;
};

export const getDepreciation = handle(async (req, res) => {
  const fy = await loadFiscalYear(req, res);
  if (!fy) return;
  res.json(await depreciationProposals(fy));
});

/** POST /fiscal-years/:id/depreciation { items: [{ assetId, amount }] } -> poistoviennit tilikauden viimeiselle päivälle. */
export const postDepreciation = handle(async (req, res) => {
  const fy = await loadFiscalYear(req, res);
  if (!fy) return;
  if (fy.status !== 'OPEN') throw new HttpError(409, 'Tilikausi on suljettu');
  const proposals = await depreciationProposals(fy);
  const created = [];
  for (const item of req.body?.items || []) {
    const p = proposals.find((x) => x.asset.id === item.assetId);
    if (!p) throw new HttpError(400, 'Tuntematon käyttöomaisuus');
    if (p.postedEntryId) continue;
    const amount = Math.round(Number(item.amount ?? p.amount) * 100) / 100;
    if (!(amount > 0)) continue;
    if (amount > p.bookValueStart) throw new HttpError(400, `${p.asset.name}: poisto ylittää kirjanpitoarvon ${p.bookValueStart} €`);
    created.push(await createPostedEntry({
      companyId: fy.companyId, fiscalYearId: fy.id, entryDate: fy.endDate,
      voucherNumber: `POISTO-${yearOf(fy.endDate)}-${p.asset.id.slice(0, 8)}`,
      description: `Poisto ${yearOf(fy.endDate)}: ${p.asset.name}`,
      entryType: 'DEPRECIATION', fixedAssetId: p.asset.id, actor: actorOf(req),
      lines: [
        { accountNumber: DEPRECIATION_ACCOUNT, debit: amount, credit: 0, description: p.asset.name },
        { accountNumber: p.asset.accountNumber, debit: 0, credit: amount, description: p.asset.name },
      ],
    }));
  }
  res.status(201).json({ created: created.length });
});

// ---------------------------------------------------------------------------
// Jaksotukset
// ---------------------------------------------------------------------------

type AccrualKind = 'accrued_expense' | 'prepaid_expense' | 'accrued_income' | 'deferred_income';

const accrualLines = (kind: AccrualKind, account: string, amount: number, description: string): Line[] => {
  // Siirtovelka: kulu kuuluu päättyvälle kaudelle, maksetaan myöhemmin (D kulu / K 2900)
  // Siirtosaaminen (ennakkomaksu): maksettu kulu kuuluu seuraavalle kaudelle (D 1800 / K kulu)
  // Siirtosaaminen (tulo): tulo kuuluu päättyvälle kaudelle, saadaan myöhemmin (D 1800 / K tulo)
  // Siirtovelka (ennakkotulo): saatu tulo kuuluu seuraavalle kaudelle (D tulo / K 2900)
  const [debit, credit] = {
    accrued_expense: [account, ACCRUED_EXPENSES],
    prepaid_expense: [ACCRUED_INCOME, account],
    accrued_income: [ACCRUED_INCOME, account],
    deferred_income: [account, ACCRUED_EXPENSES],
  }[kind];
  return [
    { accountNumber: debit, debit: amount, credit: 0, description },
    { accountNumber: credit, debit: 0, credit: amount, description },
  ];
};

/**
 * Ehdotukset ostolaskuista: suoritusjakso kuuluu (osin) päättyvälle kaudelle, mutta lasku on päivätty
 * seuraavalle (siirtovelka) – tai lasku on päivätty päättyvälle kaudelle mutta suoritusjakso on
 * seuraavalla (siirtosaaminen). Osittainen jakso jaetaan päivien suhteessa.
 */
const accrualSuggestions = async (fy: { id: string; companyId: string; startDate: Date; endDate: Date }) => {
  const endExcl = fy.endDate.getTime() + DAY;
  const invoices = await prisma.purchaseInvoice.findMany({
    where: { companyId: fy.companyId, servicePeriodStart: { not: null }, servicePeriodEnd: { not: null } },
  });
  const existing = await prisma.accountingEntry.findMany({
    where: { companyId: fy.companyId, entryType: 'ACCRUAL', entryDate: fyRange(fy) },
    select: { voucherNumber: true },
  });
  const done = new Set(existing.map((e) => e.voucherNumber));
  const vat = await loadVatSettings(fy.companyId);
  const out = [];
  for (const inv of invoices) {
    const ps = inv.servicePeriodStart!.getTime();
    const pe = inv.servicePeriodEnd!.getTime() + DAY;
    const days = Math.max(1, Math.round((pe - ps) / DAY));
    const invDate = inv.invoiceDate.getTime();
    // Kuluun kuuluu laskun summa ilman vähennettävää arvonlisäveroa (vähennys tehdään laskun omalla verokaudella).
    // Aiemmin jaksotettiin bruttosumma, jolloin ALV-velvollisen yhtiön kulu oli päättyvällä kaudella liian suuri.
    const deductible = vat.registered && inv.vatAmount && (!vat.registeredFrom || inv.invoiceDate >= vat.registeredFrom)
      ? Math.round(Number(inv.vatAmount) * Number(vat.deductionPercent) / 100 * 100) / 100 : 0;
    const total = Number(inv.totalAmount) - deductible;
    let kind: AccrualKind | null = null;
    let share = 0;
    if (invDate >= endExcl && ps < endExcl && pe > fy.startDate.getTime()) {
      kind = 'accrued_expense';
      share = (Math.min(pe, endExcl) - Math.max(ps, fy.startDate.getTime())) / DAY / days;
    } else if (invDate >= fy.startDate.getTime() && invDate < endExcl && pe > endExcl) {
      kind = 'prepaid_expense';
      share = (pe - Math.max(ps, endExcl)) / DAY / days;
    }
    if (!kind || share <= 0) continue;
    const voucherNumber = `JAKSO-${yearOf(fy.endDate)}-${inv.id.slice(0, 8)}`;
    if (done.has(voucherNumber)) continue;
    out.push({
      purchaseInvoiceId: inv.id,
      voucherNumber,
      kind,
      accountNumber: inv.expenseAccount,
      amount: Math.round(total * Math.min(share, 1) * 100) / 100,
      description: `${kind === 'accrued_expense' ? 'Siirtovelka' : 'Siirtosaaminen'}: ${inv.supplierName} ${inv.invoiceNumber || ''} (jakso ${inv.servicePeriodStart!.toISOString().slice(0, 10)}–${inv.servicePeriodEnd!.toISOString().slice(0, 10)})`.trim(),
    });
  }
  return out;
};

export const getAccruals = handle(async (req, res) => {
  const fy = await loadFiscalYear(req, res);
  if (!fy) return;
  const entries = await prisma.accountingEntry.findMany({
    where: { companyId: fy.companyId, entryType: 'ACCRUAL', entryDate: fyRange(fy) },
    include: { lines: true },
  });
  res.json({ suggestions: await accrualSuggestions(fy), entries });
});

/** POST /fiscal-years/:id/accruals { kind, accountNumber, amount, description, voucherNumber? } */
export const createAccrual = handle(async (req, res) => {
  const fy = await loadFiscalYear(req, res);
  if (!fy) return;
  if (fy.status !== 'OPEN') throw new HttpError(409, 'Tilikausi on suljettu');
  const { kind, accountNumber, amount, description, voucherNumber } = req.body || {};
  if (!['accrued_expense', 'prepaid_expense', 'accrued_income', 'deferred_income'].includes(kind)) throw new HttpError(400, 'Tuntematon jaksotuksen laji');
  const value = Math.round(Number(amount) * 100) / 100;
  if (!(value > 0) || !accountNumber) throw new HttpError(400, 'Anna tili ja positiivinen summa');
  const count = await prisma.accountingEntry.count({ where: { companyId: fy.companyId, entryType: 'ACCRUAL', entryDate: fyRange(fy) } });
  const entry = await createPostedEntry({
    companyId: fy.companyId, fiscalYearId: fy.id, entryDate: fy.endDate,
    voucherNumber: voucherNumber || `JAKSO-${yearOf(fy.endDate)}-K${count + 1}`,
    description: description || 'Jaksotus', entryType: 'ACCRUAL', actor: actorOf(req),
    lines: accrualLines(kind, String(accountNumber), value, description || 'Jaksotus'),
  });
  res.status(201).json(entry);
});

// ---------------------------------------------------------------------------
// Tilinpäätös
// ---------------------------------------------------------------------------

const buildChecklist = async (fy: { id: string; companyId: string; startDate: Date; endDate: Date; status: string }) => {
  const range = fyRange(fy);
  const drafts = await prisma.accountingEntry.count({ where: { companyId: fy.companyId, status: EntryStatus.DRAFT, entryDate: range } });
  const lines = await postedLinesOf(fy.companyId, fy);
  const balances = balancesFromLines(lines);
  const suspense = (balances[ACCOUNTS.SUSPENSE] || 0) / 100;
  const debit = lines.reduce((s, l) => s + Math.round(Number(l.debit) * 100), 0);
  const credit = lines.reduce((s, l) => s + Math.round(Number(l.credit) * 100), 0);
  const depreciation = await depreciationProposals(fy);
  const missingDep = depreciation.filter((d) => !d.postedEntryId && d.amount > 0);
  const accruals = await accrualSuggestions(fy);
  const opening = await prisma.accountingEntry.findFirst({
    where: { companyId: fy.companyId, voucherNumber: { startsWith: 'AVAUS-' }, entryDate: range },
  });
  return [
    { key: 'drafts', blocking: true, ok: drafts === 0, label: 'Kaikki viennit käsitelty', detail: drafts ? `${drafts} hyväksymätöntä luonnosta` : 'Ei luonnoksia' },
    { key: 'suspense', blocking: true, ok: suspense === 0, label: 'Selvitettävät erät (1990) nollassa', detail: suspense ? `Saldo ${suspense.toFixed(2)} €` : 'Saldo 0,00 €' },
    { key: 'balanced', blocking: true, ok: debit === credit, label: 'Debet ja kredit täsmäävät (tase täsmää)', detail: `${(debit / 100).toFixed(2)} € / ${(credit / 100).toFixed(2)} €` },
    { key: 'opening', blocking: false, ok: Boolean(opening), label: 'Avaussaldot kirjattu', detail: opening ? opening.voucherNumber : 'Avaussaldoja ei ole kirjattu' },
    {
      key: 'depreciation', blocking: false, ok: missingDep.length === 0 && depreciation.length > 0,
      label: 'Poistot kirjattu',
      detail: depreciation.length === 0 ? 'Käyttöomaisuusrekisteri on tyhjä' : missingDep.length ? `${missingDep.length} poistoa kirjaamatta` : 'Kaikki poistot kirjattu',
    },
    { key: 'accruals', blocking: false, ok: accruals.length === 0, label: 'Jaksotukset tehty', detail: accruals.length ? `${accruals.length} jaksotusehdotusta käsittelemättä` : 'Ei avoimia jaksotusehdotuksia' },
  ];
};

export const getClosingChecklist = handle(async (req, res) => {
  const fy = await loadFiscalYear(req, res);
  if (!fy) return;
  res.json({ fiscalYear: fy, items: await buildChecklist(fy) });
});

/**
 * Tilikauden sulkeminen (KPL 2:7 §, AOYL 10 luku):
 *  1. tarkistuslista (esteet aina, varoitukset vain kuitattuina),
 *  2. tilinpäätösvienti: tulostilit -> 2200 Tilikauden tulos,
 *  3. kauden viennit lukitaan ja kausi suljetaan,
 *  4. seuraava tilikausi avataan ja tasetilien saldot siirretään avausvienniksi (2200 -> 2100),
 *  5. jaksotukset puretaan seuraavan kauden alkuun.
 */
export const closeFiscalYear = handle(async (req, res) => {
  // Isännöitsijän päätös: assistentti, hallitus ja tarkastajat eivät voi
  const fy = await loadFiscalYear(req, res, 'manage');
  if (!fy) return;
  if (fy.status === 'CLOSED') throw new HttpError(409, 'Tilikausi on jo suljettu');

  const checklist = await buildChecklist(fy);
  const blocking = checklist.filter((c) => c.blocking && !c.ok);
  if (blocking.length) throw new HttpError(409, `Tilikautta ei voi sulkea: ${blocking.map((c) => `${c.label} (${c.detail})`).join('; ')}`);
  const warnings = checklist.filter((c) => !c.blocking && !c.ok);
  if (warnings.length && req.body?.acknowledgeWarnings !== true) {
    throw new HttpError(409, `Kuittaa ensin varoitukset: ${warnings.map((c) => `${c.label} (${c.detail})`).join('; ')}`);
  }

  const actor = actorOf(req);
  const year = yearOf(fy.endDate);
  const { lines: closingLines, result } = buildClosingLines(balancesFromLines(await postedLinesOf(fy.companyId, fy, { excludeClosing: true })));

  const nextStart = new Date(fy.endDate.getTime() + DAY);
  const nextEnd = new Date(Date.UTC(nextStart.getUTCFullYear() + 1, nextStart.getUTCMonth(), nextStart.getUTCDate()) - DAY);

  const summary = await prisma.$transaction(async (tx) => {
    if (closingLines.length) {
      await tx.accountingEntry.create({
        data: {
          companyId: fy.companyId, fiscalYearId: fy.id, entryDate: fy.endDate, voucherNumber: `TP-${year}`,
          description: `Tilinpäätös ${year}: tilikauden tulos tilille 2200`, entryType: 'CLOSING',
          status: EntryStatus.POSTED, createdBy: actor, postedBy: actor, postedAt: new Date(),
          lines: { create: closingLines.map((l) => ({ ...l, companyId: fy.companyId })) },
        },
      });
    }
    const locked = await tx.accountingEntry.updateMany({
      where: { companyId: fy.companyId, entryDate: fyRange(fy), status: EntryStatus.POSTED },
      data: { status: EntryStatus.LOCKED, lockedAt: new Date() },
    });
    await tx.fiscalYear.update({ where: { id: fy.id }, data: { status: 'CLOSED' } });

    let next = await tx.fiscalYear.findFirst({ where: { companyId: fy.companyId, startDate: nextStart } });
    next ??= await tx.fiscalYear.create({
      data: { companyId: fy.companyId, startDate: nextStart, endDate: nextEnd, description: `Tilikausi ${nextStart.getUTCFullYear()}` },
    });

    // Avausvienti päättyneen kauden saldoista (tilinpäätösvienti mukana => 2200 -> 2100)
    const allLines = await tx.accountingLine.findMany({
      where: { companyId: fy.companyId, entry: { entryDate: fyRange(fy), status: { in: [EntryStatus.POSTED, EntryStatus.LOCKED] } } },
      select: { accountNumber: true, debit: true, credit: true },
    });
    const carry = buildCarryForwardLines(balancesFromLines(allLines));
    const openingNumber = `AVAUS-${nextStart.getUTCFullYear()}`;
    const openingExists = await tx.accountingEntry.findUnique({ where: { companyId_voucherNumber: { companyId: fy.companyId, voucherNumber: openingNumber } } });
    if (carry.length && !openingExists) {
      await tx.accountingEntry.create({
        data: {
          companyId: fy.companyId, fiscalYearId: next.id, entryDate: nextStart, voucherNumber: openingNumber,
          description: `Avaava tase ${nextStart.toISOString().slice(0, 10)} (tilikaudelta ${year})`, entryType: 'OPENING',
          status: EntryStatus.POSTED, createdBy: 'system-closing', postedBy: actor, postedAt: new Date(),
          lines: { create: carry.map((l) => ({ ...l, companyId: fy.companyId })) },
        },
      });
    }

    // Jaksotusten purku seuraavan kauden ensimmäiselle päivälle
    const accruals = await tx.accountingEntry.findMany({
      where: { companyId: fy.companyId, entryType: 'ACCRUAL', entryDate: fyRange(fy) },
      include: { lines: true },
    });
    for (const a of accruals) {
      await tx.accountingEntry.create({
        data: {
          companyId: fy.companyId, fiscalYearId: next.id, entryDate: nextStart, voucherNumber: `${a.voucherNumber}-PURKU`,
          description: `Jaksotuksen purku: ${a.description}`, entryType: 'ACCRUAL_REVERSAL',
          status: EntryStatus.POSTED, createdBy: 'system-closing', postedBy: actor, postedAt: new Date(),
          lines: { create: a.lines.map((l) => ({ accountNumber: l.accountNumber, debit: l.credit, credit: l.debit, description: l.description, companyId: fy.companyId })) },
        },
      });
    }
    return { lockedEntries: locked.count, nextFiscalYear: next, openingCreated: Boolean(carry.length && !openingExists), accrualReversals: accruals.length };
  });

  res.json({ result, closingEntry: closingLines.length ? `TP-${year}` : null, ...summary });
});
