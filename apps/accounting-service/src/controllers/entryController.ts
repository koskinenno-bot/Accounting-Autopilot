import { Request, Response } from 'express';
import { EntryStatus } from '../../prisma/client';
import axios from 'axios';
import { prisma } from '../db';
import { toCents, validateLines } from '../validation';
import { assertCompanyAccess, serviceHeaders } from '../middleware/requireAuth';
import { recordAccountChoice } from '../services/learningService';
import { supplierKey } from '../purchaseMatching';
import { ACCOUNTS } from '../accounts';

const actorOf = (req: Request): string => (req as any).user?.userId || 'system';
const AUDIT_SERVICE_URL = process.env.AUDIT_SERVICE_URL || 'http://localhost:3009/api/v1';

export const createEntry = async (req: Request, res: Response) => {
  try {
    const { companyId, entryDate, voucherNumber, voucherId, description, lines } = req.body;

    if (!companyId || !voucherNumber) {
      return res.status(400).json({ error: 'companyId ja voucherNumber ovat pakollisia' });
    }

    const date = new Date(entryDate);
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ error: 'Virheellinen kirjauspäivä (entryDate)' });
    }

    // KPL 1:4 § - Check if a matching OPEN fiscal year exists
    const fiscalYear = await prisma.fiscalYear.findFirst({
      where: {
        companyId,
        startDate: { lte: date },
        endDate: { gte: date },
        status: 'OPEN'
      }
    });

    if (!fiscalYear) {
      return res.status(400).json({ 
        error: 'Liiketapahtumaa ei voida kirjata: Ei avointa tilikautta tälle päivämäärälle (KPL 1:4 §)' 
      });
    }

    // Validate double-entry constraint (KPL 2:2 §)
    const lineError = validateLines(lines);
    if (lineError) {
      return res.status(400).json({ error: lineError });
    }

    const entry = await prisma.accountingEntry.create({
      data: {
        companyId,
        fiscalYearId: fiscalYear.id,
        entryDate: date,
        voucherNumber,
        voucherId,
        description,
        status: EntryStatus.POSTED, // Default to POSTED for compliance once validated
        postedBy: actorOf(req),
        postedAt: new Date(),
        createdBy: actorOf(req),
        lines: {
          create: lines.map((line: any) => ({
            accountNumber: line.accountNumber,
            debit: toCents(line.debit) / 100,
            credit: toCents(line.credit) / 100,
            description: line.description,
            companyId, // pakollinen: rivi viittaa tiliin (companyId, accountNumber)
          }))
        }
      },
      include: { lines: true }
    });

    // --- Audit Logging (KPL 2:6 §) ---
    axios.post(`${AUDIT_SERVICE_URL}/audit/log`, {
      companyId,
      userId: actorOf(req),
      action: 'CREATE',
      entityType: 'JOURNAL_ENTRY',
      entityId: entry.id,
      description: `Uusi kirjanpitovienti luotu: ${voucherNumber}`,
      changes: entry
    }, { headers: serviceHeaders() }).catch(err => console.error('Delayed audit log error:', err.message));

    return res.status(201).json(entry);
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: `Tositenumero ${req.body?.voucherNumber} on jo käytössä` });
    }
    if (error?.code === 'P2003') {
      return res.status(400).json({ error: 'Vähintään yksi tilinumero puuttuu yhtiön tilikartasta' });
    }
    console.error('Entry creation error:', error);
    return res.status(500).json({ error: 'Viennin luonti epäonnistui' });
  }
};

type EntryWithLines = { id: string; companyId: string; counterparty: string | null; lines: { accountNumber: string; debit: any; credit: any }[] };

/**
 * Käsittelijän tilivalinta opitaan toimittajalle: kun automaattiviennin kulu-/tuottotili vaihdetaan,
 * seuraava saman toimittajan vienti saa saman tilin. Ostolaskun kulutili päivitetään samalla.
 */
const learnFromCorrection = async (before: EntryWithLines, after: EntryWithLines) => {
  if (!before.counterparty) return;
  const changed = after.lines.find((l, i) => before.lines[i] && before.lines[i].accountNumber !== l.accountNumber);
  if (!changed) return;
  try {
    await recordAccountChoice(after.companyId, supplierKey(before.counterparty), before.counterparty, changed.accountNumber);
    const purchase = await prisma.purchaseInvoice.findFirst({ where: { accountingEntryId: after.id } });
    const expense = after.lines.find((l) => Number(l.debit) > 0);
    if (purchase && expense) {
      await prisma.purchaseInvoice.update({ where: { id: purchase.id }, data: { expenseAccount: expense.accountNumber } });
    }
  } catch (err: any) {
    console.error('Tiliöinnin oppiminen epäonnistui:', err.message);
  }
};

export const updateEntry = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { description, lines } = req.body;

    const existing = await prisma.accountingEntry.findUnique({
      where: { id },
      include: { fiscalYear: true, lines: true } // rivit audit-lokin from-tilaan
    });

    if (!existing) return res.status(404).json({ error: 'Vientiä ei löydy' });
    if (!(await assertCompanyAccess(req, res, existing.companyId))) return;

    // KPL 2:7 § - Muuttumattomuus: kirjattua vientiä ei muuteta, se oikaistaan korjausviennillä.
    if (existing.status !== EntryStatus.DRAFT || existing.fiscalYear?.status === 'CLOSED') {
      return res.status(403).json({ error: 'Kirjausta ei voi muuttaa: vain luonnosta voi muokata, kirjattu vienti oikaistaan korjausviennillä (KPL 2:7 §)' });
    }

    // Luonnoksen rivit voi korvata (esim. selvitettävien erien 1990 rivi oikealle tilille).
    if (lines !== undefined) {
      const lineError = validateLines(lines);
      if (lineError) return res.status(400).json({ error: lineError });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (lines !== undefined) {
        await tx.accountingLine.deleteMany({ where: { entryId: id } });
        await tx.accountingLine.createMany({
          data: lines.map((line: any) => ({
            entryId: id,
            companyId: existing.companyId,
            accountNumber: String(line.accountNumber),
            debit: toCents(line.debit) / 100,
            credit: toCents(line.credit) / 100,
            description: line.description,
          })),
        });
      }
      return tx.accountingEntry.update({
        where: { id },
        data: {
          ...(description !== undefined ? { description } : {}),
          version: { increment: 1 },
        },
        include: { lines: true }
      });
    });

    if (lines !== undefined) await learnFromCorrection(existing, updated);

    // Audit Log
    axios.post(`${AUDIT_SERVICE_URL}/audit/log`, {
      companyId: updated.companyId,
      userId: actorOf(req),
      action: 'UPDATE',
      entityType: 'JOURNAL_ENTRY',
      entityId: updated.id,
      description: `Kirjanpitovientiä muokattu: ${updated.voucherNumber}`,
      changes: { from: existing, to: updated }
    }, { headers: serviceHeaders() }).catch((err) => console.error('Audit log error:', err.message));

    return res.json(updated);
  } catch (error: any) {
    if (error?.code === 'P2003') {
      return res.status(400).json({ error: 'Vähintään yksi tilinumero puuttuu yhtiön tilikartasta' });
    }
    console.error('Entry update error:', error);
    return res.status(500).json({ error: 'Muokkaus epäonnistui' });
  }
};

export const deleteEntry = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.accountingEntry.findUnique({
      where: { id },
      include: { fiscalYear: true }
    });

    if (!existing) return res.status(404).json({ error: 'Vientiä ei löydy' });
    if (!(await assertCompanyAccess(req, res, existing.companyId))) return;

    // KPL 2:7 §: kirjattua (POSTED/LOCKED) vientiä ei poisteta, vaan se oikaistaan
    // korjausviennillä. Vain luonnoksen voi poistaa.
    if (existing.status !== EntryStatus.DRAFT || existing.fiscalYear?.status === 'CLOSED') {
      return res.status(403).json({ error: 'Kirjausta ei voi poistaa: vain luonnoksen voi poistaa, kirjattu vienti oikaistaan korjausviennillä (KPL 2:7 §)' });
    }

    // Poistettu ostolaskuluonnos vapauttaa tositteen uudelleen käsiteltäväksi
    await prisma.$transaction([
      prisma.purchaseInvoice.deleteMany({ where: { accountingEntryId: id, status: 'PROPOSED' } }),
      prisma.purchaseInvoice.updateMany({ where: { paymentEntryId: id }, data: { status: 'BOOKED', paymentEntryId: null } }),
      prisma.accountingEntry.delete({ where: { id } }),
    ]);

    // Audit Log
    axios.post(`${AUDIT_SERVICE_URL}/audit/log`, {
      companyId: existing.companyId,
      userId: actorOf(req),
      action: 'DELETE',
      entityType: 'JOURNAL_ENTRY',
      entityId: id,
      description: `Kirjanpitovienti poistettu (KPL-vastainen poisto estetty yleensä lukituksella): ${existing.voucherNumber}`
    }, { headers: serviceHeaders() }).catch((err) => console.error('Audit log error:', err.message));

    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: 'Poisto epäonnistui' });
  }
};

export const getLedger = async (req: Request, res: Response) => {
  try {
    const { companyId, fiscalYearId, status } = req.query;
    
    if (!companyId) return res.status(400).json({ error: 'companyId is required' });

    // ?status=POSTED,LOCKED rajaa tilat (raportointi käyttää tätä, jotta luonnokset eivät päädy raportteihin)
    const allowed = Object.values(EntryStatus) as string[];
    const statuses = typeof status === 'string'
      ? status.split(',').map((s) => s.trim().toUpperCase()).filter((s) => allowed.includes(s))
      : [];

    const entries = await prisma.accountingEntry.findMany({
      where: { 
        companyId: companyId as string,
        ...(fiscalYearId ? { fiscalYearId: fiscalYearId as string } : {}),
        ...(statuses.length ? { status: { in: statuses as EntryStatus[] } } : {})
      },
      include: { lines: true, fiscalYear: true },
      orderBy: { entryDate: 'desc' }
    });

    return res.json(entries);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch ledger' });
  }
};

export const getStats = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.query;
    
    const where = companyId ? { companyId: companyId as string } : {};
    
    const totalEntries = await prisma.accountingEntry.count({ where });
    const pendingEntries = await prisma.accountingEntry.count({ 
      where: { ...where, status: { not: 'POSTED' } } 
    });
    const postedEntries = await prisma.accountingEntry.count({ 
      where: { ...where, status: 'POSTED' } 
    });
    
    // Automation rate: Entries created by 'system'
    const systemEntries = await prisma.accountingEntry.count({
      where: { ...where, createdBy: { startsWith: 'system' } }
    });
    
    const automationRate = totalEntries > 0 ? (systemEntries / totalEntries) * 100 : 0;

    return res.json({
      totalEntries,
      pendingEntries,
      postedEntries,
      automationRate
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch accounting stats' });
  }
};

/**
 * Luonnoksen hyväksyntä kirjatuksi (DRAFT -> POSTED).
 * Automaatio (pankki, laskut, tositteet) luo vain luonnoksia; ennen tätä niitä ei voinut hyväksyä mistään.
 */
class PostError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Yhden luonnoksen hyväksyntä; heittää PostErrorin, jos vientiä ei voi kirjata. */
const postOne = async (existing: any, actor: string, acknowledgeMissingVoucher = false) => {
  if (existing.status !== EntryStatus.DRAFT) throw new PostError(409, `Vienti on jo tilassa ${existing.status}`);
  if (existing.lines.some((l: any) => l.accountNumber === ACCOUNTS.SUSPENSE)) {
    throw new PostError(400, 'Viennillä on tili 1990 Selvitettävät erät: valitse oikea tili ennen hyväksyntää');
  }
  // KPL 2:5 §: jokaisen viennin perusteena on tosite. Tiliote riittää esim. pankkikuluille,
  // mutta siitä on päätettävä erikseen.
  if (existing.needsVoucher && !existing.voucherId && !acknowledgeMissingVoucher) {
    throw new PostError(400, 'Viennillä ei ole tositetta. Liitä ostolasku tai vahvista, että tiliote riittää tositteeksi.');
  }

  const lineError = validateLines(existing.lines.map((l: any) => ({
    accountNumber: l.accountNumber,
    debit: l.debit.toString(),
    credit: l.credit.toString(),
  })));
  if (lineError) throw new PostError(400, lineError);

  const fiscalYear = await prisma.fiscalYear.findFirst({
    where: {
      companyId: existing.companyId,
      startDate: { lte: existing.entryDate },
      endDate: { gte: existing.entryDate },
      status: 'OPEN',
    },
  });
  if (!fiscalYear) throw new PostError(400, 'Ei avointa tilikautta viennin päivämäärälle (KPL 1:4 §)');

  const [updated] = await prisma.$transaction([
    prisma.accountingEntry.update({
      where: { id: existing.id },
      data: {
        status: EntryStatus.POSTED,
        fiscalYearId: fiscalYear.id,
        postedBy: actor,
        postedAt: new Date(),
        needsVoucher: false,
        reviewNote: existing.needsVoucher && !existing.voucherId ? 'Hyväksytty tiliotteen perusteella' : existing.reviewNote,
        version: { increment: 1 },
      },
      include: { lines: true },
    }),
    // Ostolaskun kuluvienti hyväksytty => lasku on kirjattu ostovelaksi
    prisma.purchaseInvoice.updateMany({
      where: { accountingEntryId: existing.id, status: 'PROPOSED' },
      data: { status: 'BOOKED' },
    }),
  ]);

  axios.post(`${AUDIT_SERVICE_URL}/audit/log`, {
    companyId: updated.companyId,
    userId: actor,
    action: 'UPDATE',
    entityType: 'JOURNAL_ENTRY',
    entityId: updated.id,
    description: `Vienti hyväksytty kirjatuksi: ${updated.voucherNumber}`,
    changes: { status: { from: 'DRAFT', to: 'POSTED' } },
  }, { headers: serviceHeaders() }).catch((err) => console.error('Audit log error:', err.message));

  return updated;
};

export const postEntry = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.accountingEntry.findUnique({ where: { id }, include: { lines: true } });
    if (!existing) return res.status(404).json({ error: 'Vientiä ei löydy' });
    if (!(await assertCompanyAccess(req, res, existing.companyId))) return;
    return res.json(await postOne(existing, actorOf(req), req.body?.acknowledgeMissingVoucher === true));
  } catch (error) {
    if (error instanceof PostError) return res.status(error.status).json({ error: error.message });
    console.error('Post entry error:', error);
    return res.status(500).json({ error: 'Hyväksyntä epäonnistui' });
  }
};

/**
 * "Hyväksy kaikki varmat": kirjaa yhtiön luonnokset, jotka automaatio merkitsi varmoiksi
 * (tekoälyn varma ostolasku tai pankkimaksu täsmätty ostolaskuun). Muut jäävät käsiteltäviksi.
 */
export const postAutoApprovable = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.body;
    const drafts = await prisma.accountingEntry.findMany({
      where: { companyId, status: EntryStatus.DRAFT, autoApprovable: true },
      include: { lines: true },
      orderBy: { entryDate: 'asc' },
    });
    const posted: string[] = [];
    const skipped: { voucherNumber: string; reason: string }[] = [];
    for (const entry of drafts) {
      try {
        await postOne(entry, actorOf(req));
        posted.push(entry.voucherNumber);
      } catch (err: any) {
        skipped.push({ voucherNumber: entry.voucherNumber, reason: err.message });
      }
    }
    return res.json({ posted: posted.length, skipped });
  } catch (error) {
    console.error('Bulk post error:', error);
    return res.status(500).json({ error: 'Hyväksyntä epäonnistui' });
  }
};

export const listPurchaseInvoices = async (req: Request, res: Response) => {
  const { companyId, status } = req.query;
  const invoices = await prisma.purchaseInvoice.findMany({
    where: { companyId: companyId as string, ...(status ? { status: status as any } : {}) },
    orderBy: { invoiceDate: 'desc' },
  });
  return res.json(invoices);
};

export const listFiscalYears = async (req: Request, res: Response) => {
  const { companyId } = req.query;
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });
  const years = await prisma.fiscalYear.findMany({
    where: { companyId: companyId as string },
    orderBy: { startDate: 'desc' },
  });
  return res.json(years);
};

export const createFiscalYear = async (req: Request, res: Response) => {
  try {
    const { companyId, startDate, endDate, description } = req.body;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (!companyId || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return res.status(400).json({ error: 'companyId sekä kelvolliset startDate < endDate vaaditaan' });
    }
    // KPL 4:1 §: tilikausi on pääsääntöisesti 12 kk, enintään 18 kk.
    const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    if (months > 18) {
      return res.status(400).json({ error: 'Tilikausi voi olla enintään 18 kuukautta (KPL 4:1 §)' });
    }
    const overlapping = await prisma.fiscalYear.findFirst({
      where: { companyId, startDate: { lte: end }, endDate: { gte: start } },
    });
    if (overlapping) {
      return res.status(409).json({ error: 'Tilikausi menee päällekkäin olemassa olevan kanssa' });
    }
    const fy = await prisma.fiscalYear.create({ data: { companyId, startDate: start, endDate: end, description } });
    return res.status(201).json(fy);
  } catch (error) {
    console.error('Fiscal year error:', error);
    return res.status(500).json({ error: 'Tilikauden luonti epäonnistui' });
  }
};

