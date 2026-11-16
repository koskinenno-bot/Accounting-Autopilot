import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../db';
import { assertCompanyAccess } from '../middleware/requireAuth';
import {
  approvalState, buildPain001, findDuplicates, isValidBic, isValidIban, normalizeIban, normalizeReference, paymentBlocker,
} from '../payments';
import type { PayableInvoice } from '../payments';

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const handle = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('Ostolaskuvirhe:', err);
    res.status(500).json({ error: 'Toiminto epäonnistui' });
  }
};

const userOf = (req: Request): string => (req as any).user?.userId || 'system';
const roleOf = (req: Request): string | null => (req as any).companyRole ?? null;

const loadPolicy = async (companyId: string) => {
  const p = await prisma.approvalPolicy.findUnique({ where: { companyId } });
  return {
    boardLimit: p?.boardLimit === null || p?.boardLimit === undefined ? null : Number(p.boardLimit),
    debtorIban: p?.debtorIban ?? null,
    debtorBic: p?.debtorBic ?? null,
  };
};

const payable = (i: any): PayableInvoice => ({
  id: i.id, supplierName: i.supplierName, supplierKey: i.supplierKey, invoiceNumber: i.invoiceNumber,
  totalAmount: Number(i.totalAmount), dueDate: i.dueDate, referenceNumber: i.referenceNumber, iban: i.iban,
  status: i.status, approvalStatus: i.approvalStatus, paymentBatchId: i.paymentBatchId,
});

/** Ostolaskut hyväksyntä- ja maksutietoineen. */
export const listPurchases = handle(async (req, res) => {
  const companyId = String(req.query.companyId ?? '');
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  const [invoices, policy, batches] = await Promise.all([
    prisma.purchaseInvoice.findMany({
      where: { companyId },
      include: { approvals: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ dueDate: 'asc' }, { invoiceDate: 'asc' }],
    }),
    loadPolicy(companyId),
    prisma.paymentBatch.findMany({ where: { companyId, status: { not: 'CANCELLED' } }, select: { id: true, executionDate: true, status: true } }),
  ]);
  const duplicates = findDuplicates(invoices.filter((i) => i.status !== 'PAID').map(payable));
  const me = userOf(req);
  res.json({
    policy,
    myRole: roleOf(req),
    invoices: invoices.map((i) => {
      // Vanhan järjestelmän avoin lasku on hyväksytty siellä (siirto vanhasta)
      const state = i.extractor === 'MIGRATION'
        ? { status: 'APPROVED' as const, waitingFor: [], needsBoard: false }
        : approvalState(Number(i.totalAmount), policy.boardLimit, i.approvals.map((a) => ({ role: a.role, decision: a.decision as any, userId: a.userId })));
      const batch = batches.find((b) => b.id === i.paymentBatchId);
      return {
        id: i.id, supplierName: i.supplierName, supplierBusinessId: i.supplierBusinessId, invoiceNumber: i.invoiceNumber,
        invoiceDate: i.invoiceDate, dueDate: i.dueDate, totalAmount: Number(i.totalAmount), referenceNumber: i.referenceNumber,
        iban: i.iban, expenseAccount: i.expenseAccount, status: i.status, voucherId: i.voucherId,
        approvalStatus: i.status === 'PAID' && i.approvalStatus === 'PENDING' ? 'NOT_REQUIRED' : state.status,
        waitingFor: state.waitingFor, needsBoard: state.needsBoard,
        approvals: i.approvals.map((a) => ({ userId: a.userId, role: a.role, decision: a.decision, comment: a.comment, createdAt: a.createdAt })),
        myDecision: i.approvals.find((a) => a.userId === me)?.decision ?? null,
        paymentBatch: batch ? { id: batch.id, executionDate: batch.executionDate, status: batch.status } : null,
        paymentBlocker: paymentBlocker({ ...payable(i), approvalStatus: state.status }),
        duplicateOf: duplicates.get(i.id) ?? null,
      };
    }),
  });
});

/** Hyväksy tai hylkää. Hyväksyjänä isännöitsijä tai hallituksen jäsen (assistentti ja tarkastaja eivät). */
export const decide = handle(async (req, res) => {
  const invoice = await prisma.purchaseInvoice.findUnique({ where: { id: req.params.id }, include: { approvals: true } });
  if (!invoice) throw new HttpError(404, 'Ostolaskua ei löydy');
  if (!(await assertCompanyAccess(req, res, invoice.companyId, 'read'))) return;
  const role = roleOf(req);
  if (role !== 'MANAGER' && role !== 'BOARD') throw new HttpError(403, 'Ostolaskun voi hyväksyä isännöitsijä tai hallituksen jäsen');
  const { decision, comment } = req.body ?? {};
  if (decision !== 'APPROVE' && decision !== 'REJECT') throw new HttpError(400, 'decision on APPROVE tai REJECT');
  if (decision === 'REJECT' && !(typeof comment === 'string' && comment.trim())) throw new HttpError(400, 'Kirjoita hylkäyksen syy');
  if (invoice.status === 'PAID') throw new HttpError(409, 'Lasku on jo maksettu');
  if (invoice.paymentBatchId) throw new HttpError(409, 'Lasku on maksuerässä; peru maksuerä ennen päätöksen muuttamista');

  const userId = userOf(req);
  const policy = await loadPolicy(invoice.companyId);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.purchaseApproval.upsert({
      where: { invoiceId_userId: { invoiceId: invoice.id, userId } },
      create: { invoiceId: invoice.id, userId, role, decision, comment: comment?.trim() || null },
      update: { role, decision, comment: comment?.trim() || null, createdAt: new Date() },
    });
    const approvals = await tx.purchaseApproval.findMany({ where: { invoiceId: invoice.id } });
    const state = approvalState(Number(invoice.totalAmount), policy.boardLimit, approvals.map((a) => ({ role: a.role, decision: a.decision as any, userId: a.userId })));
    await tx.purchaseInvoice.update({
      where: { id: invoice.id },
      data: { approvalStatus: state.status, rejectionReason: state.status === 'REJECTED' ? (approvals.find((a) => a.decision === 'REJECT')?.comment ?? null) : null },
    });
    return state;
  });
  res.json(updated);
});

/** Oman päätöksen peruminen (ennen maksua). */
export const withdrawDecision = handle(async (req, res) => {
  const invoice = await prisma.purchaseInvoice.findUnique({ where: { id: req.params.id } });
  if (!invoice) throw new HttpError(404, 'Ostolaskua ei löydy');
  if (!(await assertCompanyAccess(req, res, invoice.companyId, 'read'))) return;
  if (invoice.paymentBatchId || invoice.status === 'PAID') throw new HttpError(409, 'Maksuun otetun laskun päätöstä ei voi perua');
  const policy = await loadPolicy(invoice.companyId);
  await prisma.purchaseApproval.deleteMany({ where: { invoiceId: invoice.id, userId: userOf(req) } });
  const approvals = await prisma.purchaseApproval.findMany({ where: { invoiceId: invoice.id } });
  const state = approvalState(Number(invoice.totalAmount), policy.boardLimit, approvals.map((a) => ({ role: a.role, decision: a.decision as any, userId: a.userId })));
  await prisma.purchaseInvoice.update({ where: { id: invoice.id }, data: { approvalStatus: state.status, ...(state.status !== 'REJECTED' ? { rejectionReason: null } : {}) } });
  res.json(state);
});

/** Saajan tilin tai viitteen korjaus ennen maksua (tekoäly ei aina lue niitä oikein). */
export const updatePaymentDetails = handle(async (req, res) => {
  const invoice = await prisma.purchaseInvoice.findUnique({ where: { id: req.params.id } });
  if (!invoice) throw new HttpError(404, 'Ostolaskua ei löydy');
  if (!(await assertCompanyAccess(req, res, invoice.companyId, 'write'))) return;
  if (invoice.paymentBatchId || invoice.status === 'PAID') throw new HttpError(409, 'Maksuun otetun laskun tietoja ei voi muuttaa');
  const { iban, referenceNumber, dueDate } = req.body ?? {};
  const data: Record<string, unknown> = {};
  if (iban !== undefined) {
    if (!isValidIban(iban)) throw new HttpError(400, 'IBAN on virheellinen');
    data.iban = normalizeIban(iban);
  }
  if (referenceNumber !== undefined) {
    if (referenceNumber && !normalizeReference(referenceNumber)) throw new HttpError(400, 'Viitenumero on virheellinen');
    data.referenceNumber = referenceNumber ? normalizeReference(referenceNumber) : null;
  }
  if (dueDate !== undefined) {
    const d = new Date(dueDate);
    if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Eräpäivä on virheellinen');
    data.dueDate = d;
  }
  // Maksutiedon muutos vaatii uuden hyväksynnän (estää tilinumeron vaihdon hyväksynnän jälkeen)
  if (data.iban !== undefined && data.iban !== invoice.iban) {
    await prisma.purchaseApproval.deleteMany({ where: { invoiceId: invoice.id } });
    data.approvalStatus = 'PENDING';
  }
  res.json(await prisma.purchaseInvoice.update({ where: { id: invoice.id }, data }));
});

export const updatePolicy = handle(async (req, res) => {
  const { companyId, boardLimit, debtorIban, debtorBic } = req.body ?? {};
  if (!(await assertCompanyAccess(req, res, companyId, 'manage'))) return;
  const limit = boardLimit === null || boardLimit === '' || boardLimit === undefined ? null : Number(boardLimit);
  if (limit !== null && (!Number.isFinite(limit) || limit < 0)) throw new HttpError(400, 'Hallituksen raja on virheellinen');
  if (debtorIban && !isValidIban(debtorIban)) throw new HttpError(400, 'Yhtiön IBAN on virheellinen');
  if (debtorBic && !isValidBic(debtorBic)) throw new HttpError(400, 'BIC on virheellinen');
  const data = { boardLimit: limit, debtorIban: debtorIban ? normalizeIban(debtorIban) : null, debtorBic: debtorBic ? String(debtorBic).toUpperCase() : null };
  await prisma.approvalPolicy.upsert({ where: { companyId }, create: { companyId, ...data }, update: data });
  // Raja vaikuttaa avoimien laskujen tilaan: lasketaan uudelleen
  const open = await prisma.purchaseInvoice.findMany({ where: { companyId, status: { not: 'PAID' }, paymentBatchId: null }, include: { approvals: true } });
  for (const i of open) {
    const state = approvalState(Number(i.totalAmount), limit, i.approvals.map((a) => ({ role: a.role, decision: a.decision as any, userId: a.userId })));
    if (state.status !== i.approvalStatus) await prisma.purchaseInvoice.update({ where: { id: i.id }, data: { approvalStatus: state.status } });
  }
  res.json(await loadPolicy(companyId));
});

/** Maksuaineisto valituista hyväksytyistä laskuista. Rahaa ei liikuteta: isännöitsijä lähettää tiedoston verkkopankissa. */
export const createBatch = handle(async (req, res) => {
  const { companyId, invoiceIds, executionDate, debtorName, debtorIban, debtorBic } = req.body ?? {};
  if (!(await assertCompanyAccess(req, res, companyId, 'write'))) return;
  if (!Array.isArray(invoiceIds) || !invoiceIds.length) throw new HttpError(400, 'Valitse maksettavat laskut');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(executionDate ?? ''))) throw new HttpError(400, 'Maksupäivä puuttuu');
  const policy = await loadPolicy(companyId);
  const iban = normalizeIban(debtorIban || policy.debtorIban);
  if (!isValidIban(iban)) throw new HttpError(400, 'Yhtiön maksutili (IBAN) puuttuu tai on virheellinen');
  const bic = debtorBic || policy.debtorBic;
  if (typeof debtorName !== 'string' || !debtorName.trim()) throw new HttpError(400, 'Maksajan nimi puuttuu');

  const batch = await prisma.$transaction(async (tx) => {
    const invoices = await tx.purchaseInvoice.findMany({ where: { companyId, id: { in: invoiceIds.map(String) } } });
    if (invoices.length !== invoiceIds.length) throw new HttpError(400, 'Osa laskuista ei kuulu yhtiölle');
    for (const i of invoices) {
      const blocker = paymentBlocker(payable(i));
      if (blocker) throw new HttpError(409, `${i.supplierName} ${i.invoiceNumber ?? ''}: ${blocker}`);
    }
    const messageId = `AIA${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const xml = buildPain001({
      messageId, createdAt: new Date(), executionDate, debtorName: debtorName.trim(), debtorIban: iban, debtorBic: bic,
      payments: invoices.map((i, n) => ({
        endToEndId: `${messageId}-${n + 1}`,
        amount: Number(i.totalAmount),
        creditorName: i.supplierName,
        creditorIban: i.iban!,
        reference: normalizeReference(i.referenceNumber),
        message: `Lasku ${i.invoiceNumber ?? ''} ${i.supplierName}`.trim(),
      })),
    });
    const total = invoices.reduce((s, i) => s + Math.round(Number(i.totalAmount) * 100), 0) / 100;
    const created = await tx.paymentBatch.create({
      data: {
        companyId, messageId, executionDate: new Date(executionDate), debtorName: debtorName.trim(), debtorIban: iban,
        debtorBic: bic || null, totalAmount: total, count: invoices.length, xml, createdBy: userOf(req),
      },
    });
    // Ehto paymentBatchId = null estää saman laskun päätymisen kahteen rinnakkain luotuun erään
    const claimed = await tx.purchaseInvoice.updateMany({
      where: { id: { in: invoices.map((i) => i.id) }, paymentBatchId: null, status: { not: 'PAID' } },
      data: { paymentBatchId: created.id },
    });
    if (claimed.count !== invoices.length) throw new HttpError(409, 'Osa laskuista otettiin juuri toiseen maksuerään');
    return created;
  });
  if (!policy.debtorIban) {
    await prisma.approvalPolicy.upsert({ where: { companyId }, create: { companyId, debtorIban: iban, debtorBic: bic || null }, update: { debtorIban: iban } });
  }
  res.status(201).json({ ...batch, xml: undefined, totalAmount: Number(batch.totalAmount) });
});

export const listBatches = handle(async (req, res) => {
  const companyId = String(req.query.companyId ?? '');
  if (!(await assertCompanyAccess(req, res, companyId, 'read'))) return;
  const batches = await prisma.paymentBatch.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 50 });
  const invoices = await prisma.purchaseInvoice.findMany({
    where: { paymentBatchId: { in: batches.map((b) => b.id) } },
    select: { id: true, paymentBatchId: true, supplierName: true, invoiceNumber: true, totalAmount: true, status: true },
  });
  res.json(batches.map(({ xml: _xml, ...b }) => ({
    ...b,
    totalAmount: Number(b.totalAmount),
    invoices: invoices.filter((i) => i.paymentBatchId === b.id).map((i) => ({ ...i, totalAmount: Number(i.totalAmount) })),
  })));
});

export const downloadBatch = handle(async (req, res) => {
  const batch = await prisma.paymentBatch.findUnique({ where: { id: req.params.id } });
  if (!batch) throw new HttpError(404, 'Maksuerää ei löydy');
  if (!(await assertCompanyAccess(req, res, batch.companyId, 'write'))) return;
  if (batch.status === 'CANCELLED') throw new HttpError(409, 'Maksuerä on peruttu');
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="maksut-${batch.executionDate.toISOString().slice(0, 10)}-${batch.messageId}.xml"`);
  res.send(batch.xml);
});

/** Merkitse lähetetyksi pankkiin (lukitsee erän) tai peru (laskut vapautuvat uuteen erään). */
export const updateBatch = handle(async (req, res) => {
  const batch = await prisma.paymentBatch.findUnique({ where: { id: req.params.id } });
  if (!batch) throw new HttpError(404, 'Maksuerää ei löydy');
  if (!(await assertCompanyAccess(req, res, batch.companyId, 'write'))) return;
  const { status } = req.body ?? {};
  if (status === 'SENT') {
    if (batch.status !== 'CREATED') throw new HttpError(409, 'Vain luotu erä voidaan merkitä lähetetyksi');
    await prisma.paymentBatch.update({ where: { id: batch.id }, data: { status: 'SENT', sentAt: new Date() } });
  } else if (status === 'CANCELLED') {
    if (batch.status !== 'CREATED') {
      throw new HttpError(409, 'Pankkiin lähetettyä erää ei voi perua täältä. Peru maksut verkkopankissa ja ota yhteyttä tukeen.');
    }
    await prisma.$transaction([
      prisma.paymentBatch.update({ where: { id: batch.id }, data: { status: 'CANCELLED' } }),
      prisma.purchaseInvoice.updateMany({ where: { paymentBatchId: batch.id, status: { not: 'PAID' } }, data: { paymentBatchId: null } }),
    ]);
  } else {
    throw new HttpError(400, 'status on SENT tai CANCELLED');
  }
  res.json({ ok: true });
});
