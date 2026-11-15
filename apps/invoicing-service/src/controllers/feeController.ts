import { Request, Response } from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../db';
import { assertCompanyAccess } from '../middleware/requireAuth';
import { nextInvoiceNumber, referenceFor } from '../services/invoiceNumberService';
import { publishInvoiceCreated } from '../utils/kafka';
import {
  BASIS_LABELS, DEFAULT_COMPONENTS, calculateFees, countShares, isPeriod, loanShareOf, periodLabel,
} from '../fees';
import type { ApartmentInput, FeeBasis, FeeComponentInput } from '../fees';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001/api/v1';
const BASES = Object.keys(BASIS_LABELS) as FeeBasis[];

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const handle = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('Vastikevirhe:', err);
    res.status(500).json({ error: 'Toiminto epäonnistui' });
  }
};

const num = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const userOf = (req: Request) => (req as any).user?.userId ?? null;

const toInput = (c: any): FeeComponentInput => ({
  id: c.id, name: c.name, basis: c.basis as FeeBasis, unitPrice: Number(c.unitPrice), accountNumber: c.accountNumber,
  loanCapital: c.loanCapital, isActive: c.isActive, vatRate: Number(c.vatRate ?? 0),
});

/**
 * Huoneistot osakasluettelosta (user-service). Kutsu tehdään käyttäjän omalla tunnisteella, jolloin
 * user-service tarkistaa myös yhtiön käyttöoikeuden. Saman huoneiston omistajat yhdistetään.
 */
export const fetchApartments = async (req: Request, companyId: string, onDate: Date): Promise<ApartmentInput[]> => {
  const { data } = await axios.get(`${USER_SERVICE_URL}/shareholders`, {
    params: { companyId },
    headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
    timeout: 15_000,
  });
  const map = new Map<string, ApartmentInput>();
  for (const sh of data as any[]) {
    const name = sh.companyName || [sh.firstName, sh.lastName].filter(Boolean).join(' ') || sh.email;
    for (const share of sh.shares ?? []) {
      if (share.ownershipEnd && new Date(share.ownershipEnd) <= onDate) continue;
      const ap = share.apartment ?? {};
      const key = String(ap.number ?? '').trim();
      if (!key) continue;
      const row = map.get(key) ?? {
        apartment: key, owners: [], squareMeters: 0, shares: 0, persons: 0, parkingSpots: 0,
      };
      if (!row.owners.some((o) => o.shareholderId === sh.id)) row.owners.push({ shareholderId: sh.id, name, email: sh.email });
      // Huoneiston tiedot ovat samat kaikilla omistajilla; osakkeet lasketaan yhteen vain eri osakeryhmistä
      row.squareMeters = Math.max(row.squareMeters, Number(ap.squareMeters) || 0);
      row.persons = Math.max(row.persons, Number(ap.persons) || 0);
      row.parkingSpots = Math.max(row.parkingSpots, Number(ap.parkingSpots) || 0);
      row.shares = Math.max(row.shares, countShares(share.shareNumbers));
      map.set(key, row);
    }
  }
  return [...map.values()];
};

const loadSettings = async (companyId: string) => {
  const s = await prisma.reskontraSettings.findUnique({ where: { companyId } });
  return {
    referenceRate: s ? Number(s.referenceRate) : 2,
    reminderFee: s ? Number(s.reminderFee) : 5,
    reminderDaysAfterDue: s?.reminderDaysAfterDue ?? 14,
    paymentTermDays: s?.paymentTermDays ?? 14,
    saved: Boolean(s),
  };
};
export { loadSettings };

/** Vastikeperusteet, lainaosuudet, pois maksut ja huoneistot yhdellä kertaa (Vastikkeet-sivu). */
export const getFeeSetup = handle(async (req, res) => {
  const companyId = String(req.query.companyId ?? '');
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  const [components, payoffs, settings] = await Promise.all([
    prisma.feeComponent.findMany({ where: { companyId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.loanPayoff.findMany({ where: { companyId }, orderBy: { paidOn: 'asc' } }),
    loadSettings(companyId),
  ]);
  let apartments: ApartmentInput[] = [];
  let apartmentsError: string | null = null;
  try {
    apartments = await fetchApartments(req, companyId, new Date());
  } catch (err: any) {
    apartmentsError = 'Osakasluetteloa ei saatu haettua käyttäjäpalvelusta';
    console.error('Osakasluettelon haku epäonnistui:', err?.message);
  }
  const totalShares = apartments.reduce((s, a) => s + a.shares, 0);
  const loanComponents = components.filter((c) => c.loanCapital && c.loanAmount);
  res.json({
    components: components.map((c) => ({ ...toInput(c), loanAmount: c.loanAmount === null ? null : Number(c.loanAmount), sortOrder: c.sortOrder })),
    payoffs: payoffs.map((p) => ({ ...p, amount: Number(p.amount) })),
    settings,
    totalShares,
    apartmentsError,
    apartments: apartments
      .sort((a, b) => a.apartment.localeCompare(b.apartment, 'fi', { numeric: true }))
      .map((a) => ({
        ...a,
        loanShares: loanComponents.map((c) => ({
          componentId: c.id,
          amount: loanShareOf(Number(c.loanAmount), a.shares, totalShares),
          paidOff: payoffs.some((p) => p.apartment === a.apartment && p.componentId === c.id),
        })),
      })),
  });
});

const validateComponent = (body: any, partial: boolean) => {
  const out: Record<string, unknown> = {};
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw new HttpError(400, 'Vastikkeen nimi puuttuu');
    out.name = body.name.trim();
  }
  if (!partial || body.basis !== undefined) {
    if (!BASES.includes(body.basis)) throw new HttpError(400, `Peruste on yksi näistä: ${BASES.join(', ')}`);
    out.basis = body.basis;
  }
  if (!partial || body.unitPrice !== undefined) {
    const p = num(body.unitPrice);
    if (!Number.isFinite(p) || p < 0) throw new HttpError(400, 'Yksikköhinta on oltava 0 tai suurempi');
    out.unitPrice = p;
  }
  if (!partial || body.accountNumber !== undefined) {
    const a = String(body.accountNumber ?? '');
    if (!/^3\d{3,5}$/.test(a)) throw new HttpError(400, 'Tulotili on 3000–3999-alueella (esim. 3000 hoitovastikkeet)');
    out.accountNumber = a;
  }
  if (body.loanCapital !== undefined) out.loanCapital = Boolean(body.loanCapital);
  if (body.loanAmount !== undefined) {
    const l = body.loanAmount === null || body.loanAmount === '' ? null : num(body.loanAmount);
    if (l !== null && (!Number.isFinite(l) || l < 0)) throw new HttpError(400, 'Lainan pääoma on virheellinen');
    out.loanAmount = l;
  }
  if (body.vatRate !== undefined) {
    const v = body.vatRate === null || body.vatRate === '' ? 0 : num(body.vatRate);
    if (![0, 10, 13.5, 25.5].includes(v)) throw new HttpError(400, 'ALV-prosentti on 0, 10, 13,5 tai 25,5');
    out.vatRate = v;
  }
  if (body.isActive !== undefined) out.isActive = Boolean(body.isActive);
  if (body.sortOrder !== undefined && Number.isInteger(Number(body.sortOrder))) out.sortOrder = Number(body.sortOrder);
  return out;
};

export const createComponent = handle(async (req, res) => {
  const { companyId } = req.body ?? {};
  if (!(await assertCompanyAccess(req, res, companyId, 'manage'))) return;
  const data = validateComponent(req.body, false);
  const count = await prisma.feeComponent.count({ where: { companyId } });
  const created = await prisma.feeComponent.create({ data: { companyId, sortOrder: count, ...(data as any) } });
  res.status(201).json(created);
});

/** Oletusperusteet (hoito, rahoitus, vesi, autopaikka) yhtiölle, jolla ei vielä ole perusteita. */
export const createDefaultComponents = handle(async (req, res) => {
  const { companyId } = req.body ?? {};
  if (!(await assertCompanyAccess(req, res, companyId, 'manage'))) return;
  if (await prisma.feeComponent.count({ where: { companyId } })) throw new HttpError(409, 'Yhtiöllä on jo vastikeperusteet');
  await prisma.feeComponent.createMany({
    data: DEFAULT_COMPONENTS.map((c, i) => ({ companyId, ...c, unitPrice: 0, sortOrder: i })),
  });
  res.status(201).json({ ok: true });
});

export const updateComponent = handle(async (req, res) => {
  const component = await prisma.feeComponent.findUnique({ where: { id: req.params.id } });
  if (!component) throw new HttpError(404, 'Vastikeperustetta ei löydy');
  if (!(await assertCompanyAccess(req, res, component.companyId, 'manage'))) return;
  const updated = await prisma.feeComponent.update({ where: { id: component.id }, data: validateComponent(req.body ?? {}, true) as any });
  res.json(updated);
});

export const createPayoff = handle(async (req, res) => {
  const { companyId, apartment, componentId, amount, paidOn, note } = req.body ?? {};
  if (!(await assertCompanyAccess(req, res, companyId, 'manage'))) return;
  const component = await prisma.feeComponent.findUnique({ where: { id: String(componentId ?? '') } });
  if (!component || component.companyId !== companyId) throw new HttpError(400, 'Valitse yhtiön rahoitusvastike');
  if (!component.loanCapital) throw new HttpError(400, 'Lainaosuuden voi maksaa pois vain rahoitusvastikkeesta');
  if (typeof apartment !== 'string' || !apartment.trim()) throw new HttpError(400, 'Huoneisto puuttuu');
  const a = num(amount);
  if (!Number.isFinite(a) || a <= 0) throw new HttpError(400, 'Pois maksettu summa puuttuu');
  const date = new Date(paidOn);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Maksupäivä puuttuu');
  try {
    const created = await prisma.loanPayoff.create({
      data: { companyId, apartment: apartment.trim(), componentId, amount: a, paidOn: date, note: note || null },
    });
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.code === 'P2002') throw new HttpError(409, `Huoneisto ${apartment} on jo maksanut tämän lainaosuuden`);
    throw err;
  }
});

export const deletePayoff = handle(async (req, res) => {
  const payoff = await prisma.loanPayoff.findUnique({ where: { id: req.params.id } });
  if (!payoff) throw new HttpError(404, 'Merkintää ei löydy');
  if (!(await assertCompanyAccess(req, res, payoff.companyId, 'manage'))) return;
  await prisma.loanPayoff.delete({ where: { id: payoff.id } });
  res.json({ ok: true });
});

export const updateSettings = handle(async (req, res) => {
  const { companyId, referenceRate, reminderFee, reminderDaysAfterDue, paymentTermDays } = req.body ?? {};
  if (!(await assertCompanyAccess(req, res, companyId, 'manage'))) return;
  const rate = num(referenceRate);
  const fee = num(reminderFee);
  const after = Number(reminderDaysAfterDue);
  const term = Number(paymentTermDays);
  if (!Number.isFinite(rate) || rate < 0 || rate > 20) throw new HttpError(400, 'Viitekorko on 0–20 %');
  if (!Number.isFinite(fee) || fee < 0 || fee > 5) throw new HttpError(400, 'Muistutusmaksu on enintään 5 € (perintälaki)');
  if (!Number.isInteger(after) || after < 1) throw new HttpError(400, 'Muistutuksen viive on vähintään 1 päivä');
  if (!Number.isInteger(term) || term < 14) throw new HttpError(400, 'Muistutuksen maksuaika on vähintään 14 päivää (perintälaki)');
  const data = { referenceRate: rate, reminderFee: fee, reminderDaysAfterDue: after, paymentTermDays: term };
  await prisma.reskontraSettings.upsert({ where: { companyId }, create: { companyId, ...data }, update: data });
  res.json(await loadSettings(companyId));
});

/**
 * Vastikkeiden laskutusajo kaudelle (YYYY-MM). dryRun=true palauttaa esikatselun luomatta laskuja.
 * Toistettava: kaudelle jo laskutetut huoneistot ohitetaan.
 */
export const runFees = handle(async (req, res) => {
  const { companyId, period, dueDate, issueDate, dryRun } = req.body ?? {};
  if (!(await assertCompanyAccess(req, res, companyId, 'write'))) return;
  if (!isPeriod(period)) throw new HttpError(400, 'Kausi on muotoa VVVV-KK');
  const due = new Date(dueDate);
  const issued = issueDate ? new Date(issueDate) : new Date();
  if (Number.isNaN(due.getTime()) || Number.isNaN(issued.getTime())) throw new HttpError(400, 'Lasku- tai eräpäivä puuttuu');
  if (due < issued) throw new HttpError(400, 'Eräpäivä on ennen laskupäivää');

  const components = (await prisma.feeComponent.findMany({ where: { companyId, isActive: true }, orderBy: { sortOrder: 'asc' } }))
    .map(toInput);
  if (!components.some((c) => c.unitPrice > 0)) throw new HttpError(400, 'Aseta ensin vastikeperusteiden hinnat');
  const apartments = await fetchApartments(req, companyId, issued);
  if (!apartments.length) throw new HttpError(400, 'Osakasluettelossa ei ole huoneistoja. Tuo osakasluettelo ensin.');

  const payoffs = await prisma.loanPayoff.findMany({ where: { companyId, paidOn: { lte: issued } } });
  const exemptions = new Map<string, Set<string>>();
  for (const p of payoffs) exemptions.set(p.apartment, (exemptions.get(p.apartment) ?? new Set()).add(p.componentId));

  const fees = calculateFees(components, apartments, exemptions);
  const billed = new Set((await prisma.invoice.findMany({
    where: { companyId, kind: 'FEE', period, status: { not: 'CANCELLED' } }, select: { apartment: true },
  })).map((i) => i.apartment));
  const rows = fees.map((f) => ({ ...f, alreadyBilled: billed.has(f.apartment) }));
  const toBill = rows.filter((r) => !r.alreadyBilled);
  const sum = (list: typeof rows) => list.reduce((s, r) => s + Math.round(r.total * 100), 0) / 100;

  if (dryRun) {
    return res.json({ period, rows, count: toBill.length, total: sum(toBill), alreadyBilled: rows.length - toBill.length });
  }

  const label = periodLabel(period);
  const created: string[] = [];
  for (const fee of toBill) {
    const invoiceNumber = await nextInvoiceNumber(prisma, companyId);
    const referenceNumber = referenceFor(companyId, invoiceNumber);
    const invoice = await prisma.invoice.create({
      data: {
        companyId, invoiceNumber, referenceNumber,
        recipientName: fee.recipientName, recipientEmail: fee.recipientEmail,
        issueDate: issued, dueDate: due, totalAmount: fee.total, status: 'SENT',
        kind: 'FEE', period, apartment: fee.apartment, shareholderId: fee.shareholderId,
        lines: {
          create: fee.lines.map((l) => ({
            description: `${l.description} ${label}`, quantity: l.quantity, unitPrice: l.unitPrice,
            vatRate: l.vatRate, totalAmount: l.amount, accountNumber: l.accountNumber,
          })),
        },
      },
    });
    created.push(invoice.id);
    await publishInvoiceCreated({
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      data: {
        invoiceId: invoice.id, companyId, amount: fee.total, referenceNumber,
        dueDate: due.toISOString(), issueDate: issued.toISOString(),
        description: `Vastikkeet ${label}, ${fee.apartment}`,
        lines: fee.lines.map((l) => ({
          accountNumber: l.accountNumber, amount: l.amount, description: l.description,
          ...(l.vatAmount ? { vatRate: l.vatRate, vatAmount: l.vatAmount } : {}),
        })),
      },
    }).catch((err) => console.error('Kirjanpitotapahtuman lähetys epäonnistui:', err?.message));
  }
  res.status(201).json({ period, created: created.length, total: sum(toBill), alreadyBilled: rows.length - toBill.length, createdBy: userOf(req) });
});
