import { Request, Response } from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../db';
import { assertCompanyAccess, serviceHeaders } from '../middleware/requireAuth';
import { nextInvoiceNumber, referenceFor } from '../services/invoiceNumberService';
import { publishInvoiceCreated, publishInvoiceStatusChanged } from '../utils/kafka';
import {
  DAY, apartmentBalances, daysOverdue, lateInterestRate, openAmount, reminderCandidates, statusAfterPayment,
} from '../reskontra';
import type { InvoiceForLedger } from '../reskontra';
import { loadSettings } from './feeController';

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008/api/v1';
/** Muistutusmaksu ja viivästyskorko kirjataan omille tuottotileilleen (taloyhtiön tilikarttapohja). */
const REMINDER_FEE_ACCOUNT = '3600';   // Muut hoitotuotot
const LATE_INTEREST_ACCOUNT = '3960';  // Muut rahoitustuotot

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const handle = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('Reskontravirhe:', err);
    res.status(500).json({ error: 'Toiminto epäonnistui' });
  }
};

const fmtEur = (n: number) => `${n.toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fmtDate = (d: Date) => d.toLocaleDateString('fi-FI', { timeZone: 'UTC' });
const userOf = (req: Request) => (req as any).user?.userId ?? null;

const forLedger = (i: any): InvoiceForLedger => ({
  id: i.id, apartment: i.apartment, recipientName: i.recipientName, kind: i.kind, status: i.status,
  issueDate: i.issueDate, dueDate: i.dueDate, totalAmount: Number(i.totalAmount), paidAmount: Number(i.paidAmount),
  lastReminderAt: i.lastReminderAt,
});

/** Kirjaa suorituksen laskulle ja päivittää maksetun summan ja tilan (sama logiikka pankille ja käsin). */
export const recordPayment = async (
  invoice: { id: string; companyId: string; totalAmount: any; paidAmount: any; status: string },
  payment: { amount: number; paidOn: Date; source: 'BANK' | 'MANUAL'; bankRef?: string | null; note?: string | null; createdBy?: string | null },
) => {
  const result = await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        invoiceId: invoice.id, companyId: invoice.companyId, amount: payment.amount, paidOn: payment.paidOn,
        source: payment.source, bankRef: payment.bankRef ?? null, note: payment.note ?? null, createdBy: payment.createdBy ?? null,
      },
    });
    const agg = await tx.payment.aggregate({ where: { invoiceId: invoice.id }, _sum: { amount: true } });
    const paid = Number(agg._sum.amount ?? 0);
    const status = statusAfterPayment(Number(invoice.totalAmount), paid, invoice.status);
    return tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount: paid, status: status as any } });
  });
  if (result.status !== invoice.status) {
    await publishInvoiceStatusChanged({
      id: uuidv4(), timestamp: new Date().toISOString(),
      data: { invoiceId: result.id, companyId: result.companyId, status: result.status },
    }).catch((err) => console.error('Tilamuutoksen lähetys epäonnistui:', err?.message));
  }
  return result;
};

/** Reskontra: huoneistokohtaiset saldot ja laskut suorituksineen. */
export const getReskontra = handle(async (req, res) => {
  const companyId = String(req.query.companyId ?? '');
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  const today = new Date();
  const invoices = await prisma.invoice.findMany({
    where: { companyId },
    include: { payments: { orderBy: { paidOn: 'asc' } }, lines: true },
    orderBy: [{ issueDate: 'desc' }, { invoiceNumber: 'desc' }],
  });
  const ledger = invoices.map(forLedger);
  res.json({
    balances: apartmentBalances(ledger, today),
    invoices: invoices.map((i, idx) => ({
      id: i.id, invoiceNumber: i.invoiceNumber, referenceNumber: i.referenceNumber, kind: i.kind, period: i.period,
      apartment: i.apartment, recipientName: i.recipientName, recipientEmail: i.recipientEmail, status: i.status,
      issueDate: i.issueDate, dueDate: i.dueDate, totalAmount: Number(i.totalAmount), paidAmount: Number(i.paidAmount),
      open: openAmount(ledger[idx]), daysOverdue: openAmount(ledger[idx]) > 0 ? daysOverdue(i.dueDate, today) : 0,
      lastReminderAt: i.lastReminderAt, remindedInvoiceId: i.remindedInvoiceId,
      lines: i.lines.map((l) => ({ description: l.description, amount: Number(l.totalAmount), accountNumber: l.accountNumber })),
      payments: i.payments.map((p) => ({ id: p.id, amount: Number(p.amount), paidOn: p.paidOn, source: p.source, note: p.note })),
    })),
  });
});

/** Suoritus käsin, esim. viitteetön maksu tai käteinen. Osasuoritus sallittu. */
export const addPayment = handle(async (req, res) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
  if (!invoice) throw new HttpError(404, 'Laskua ei löydy');
  if (!(await assertCompanyAccess(req, res, invoice.companyId, 'write'))) return;
  if (invoice.status === 'CANCELLED') throw new HttpError(409, 'Mitätöidylle laskulle ei voi kirjata suoritusta');
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Suorituksen summa puuttuu');
  const paidOn = new Date(req.body?.paidOn ?? Date.now());
  if (Number.isNaN(paidOn.getTime())) throw new HttpError(400, 'Maksupäivä on virheellinen');
  const updated = await recordPayment(invoice, {
    amount: Math.round(amount * 100) / 100, paidOn, source: 'MANUAL', note: req.body?.note || null, createdBy: userOf(req),
  });
  res.status(201).json({ ...updated, totalAmount: Number(updated.totalAmount), paidAmount: Number(updated.paidAmount) });
});

/** Erääntyneet laskut, viivästyskorko tähän päivään ja tieto siitä, voiko muistutuksen lähettää. */
export const getReminders = handle(async (req, res) => {
  const companyId = String(req.query.companyId ?? '');
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  const settings = await loadSettings(companyId);
  const invoices = await prisma.invoice.findMany({
    where: { companyId, status: { in: ['SENT', 'OVERDUE'] }, dueDate: { lt: new Date() } },
  });
  res.json({
    settings: { ...settings, lateInterestRate: lateInterestRate(settings.referenceRate) },
    candidates: reminderCandidates(invoices.map(forLedger), new Date(), settings).map((c) => {
      const inv = invoices.find((i) => i.id === c.invoiceId)!;
      return { ...c, invoiceNumber: inv.invoiceNumber, referenceNumber: inv.referenceNumber, period: inv.period, recipientEmail: inv.recipientEmail };
    }),
  });
});

/**
 * Lähettää maksumuistutukset valituista laskuista. Muistutuskulu ja viivästyskorko laskutetaan omalla
 * muistutuslaskulla (oma viite), alkuperäinen lasku maksetaan edelleen omalla viitteellään.
 */
export const sendReminders = handle(async (req, res) => {
  const { companyId, invoiceIds } = req.body ?? {};
  if (!(await assertCompanyAccess(req, res, companyId, 'write'))) return;
  if (!Array.isArray(invoiceIds) || !invoiceIds.length) throw new HttpError(400, 'Valitse muistutettavat laskut');
  const settings = await loadSettings(companyId);
  const today = new Date();
  const invoices = await prisma.invoice.findMany({ where: { companyId, id: { in: invoiceIds.map(String) } } });
  const candidates = reminderCandidates(invoices.map(forLedger), today, settings);
  const sent: { invoiceId: string; reminderInvoiceId: string | null; total: number }[] = [];
  const skipped: { invoiceId: string; reason: string }[] = [];
  for (const id of invoiceIds.map(String)) {
    const c = candidates.find((x) => x.invoiceId === id);
    if (!c) { skipped.push({ invoiceId: id, reason: 'Lasku ei ole erääntynyt tai se on maksettu' }); continue; }
    if (!c.eligible) { skipped.push({ invoiceId: id, reason: c.reason ?? 'Ei muistutettavissa' }); continue; }
    const original = invoices.find((i) => i.id === id)!;
    const due = new Date(today.getTime() + settings.paymentTermDays * DAY);
    const lines = [
      ...(c.fee > 0 ? [{ description: `Maksumuistutus, lasku ${original.invoiceNumber}`, amount: c.fee, accountNumber: REMINDER_FEE_ACCOUNT }] : []),
      ...(c.interest > 0 ? [{
        description: `Viivästyskorko ${lateInterestRate(settings.referenceRate).toLocaleString('fi-FI')} %, ${c.daysOverdue} pv`,
        amount: c.interest, accountNumber: LATE_INTEREST_ACCOUNT,
      }] : []),
    ];
    const total = Math.round(lines.reduce((s, l) => s + l.amount * 100, 0)) / 100;
    let reminder: { id: string; referenceNumber: string | null; invoiceNumber: string } | null = null;
    if (total > 0) {
      const invoiceNumber = await nextInvoiceNumber(prisma, companyId);
      const referenceNumber = referenceFor(companyId, invoiceNumber);
      reminder = await prisma.invoice.create({
        data: {
          companyId, invoiceNumber, referenceNumber, recipientName: original.recipientName, recipientEmail: original.recipientEmail,
          issueDate: today, dueDate: due, totalAmount: total, status: 'SENT', kind: 'REMINDER',
          apartment: original.apartment, shareholderId: original.shareholderId, remindedInvoiceId: original.id,
          lines: { create: lines.map((l) => ({ description: l.description, quantity: 1, unitPrice: l.amount, vatRate: 0, totalAmount: l.amount, accountNumber: l.accountNumber })) },
        },
      });
      await publishInvoiceCreated({
        id: uuidv4(), timestamp: new Date().toISOString(),
        data: {
          invoiceId: reminder.id, companyId, amount: total, referenceNumber, dueDate: due.toISOString(), issueDate: today.toISOString(),
          description: `Maksumuistutus ${original.apartment ?? original.recipientName}`, lines,
        },
      }).catch((err) => console.error('Kirjanpitotapahtuman lähetys epäonnistui:', err?.message));
    }
    await prisma.invoice.update({ where: { id: original.id }, data: { lastReminderAt: today, status: 'OVERDUE' } });
    sent.push({ invoiceId: id, reminderInvoiceId: reminder?.id ?? null, total });

    if (original.recipientEmail) {
      const body = [
        `Hyvä ${original.recipientName},`,
        '',
        `kirjanpitomme mukaan lasku ${original.invoiceNumber} (eräpäivä ${fmtDate(original.dueDate)}) on maksamatta ${fmtEur(c.open)}.`,
        `Maksathan sen viitteellä ${original.referenceNumber} viimeistään ${fmtDate(due)}.`,
        ...(reminder ? [`Muistutuskulu ja viivästyskorko ${fmtEur(total)} maksetaan viitteellä ${reminder.referenceNumber}.`] : []),
        '',
        'Jos olet jo maksanut, tämä muistutus on aiheeton.',
      ].join('\n');
      axios.post(`${NOTIFICATION_SERVICE_URL}/notify/email`, {
        companyId, recipient: original.recipientEmail, subject: `Maksumuistutus: lasku ${original.invoiceNumber}`,
        template: 'payment-reminder', data: { body, recipientName: original.recipientName },
      }, { headers: serviceHeaders(), timeout: 10_000 }).catch((err) => console.error('Muistutuksen sähköposti epäonnistui:', err?.message));
    }
  }
  res.json({ sent, skipped });
});
