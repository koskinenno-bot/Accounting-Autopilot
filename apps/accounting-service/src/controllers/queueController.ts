import { Request, Response } from 'express';
import { EntryStatus, FiscalYearStatus } from '../../prisma/client';
import { prisma } from '../db';
import { assertCompanyAccess, getCompanyRole, roleAllows } from '../middleware/requireAuth';
import { buildQueue, isSnoozed } from '../queue';

const MAX_COMPANIES = 200;
const KEY = /^(entry|voucher|invoice|closing):[\w-]+$|^(bank|auto)$/;

const entryAmount = (lines: { debit: unknown }[]) =>
  Math.round(lines.reduce((s, l) => s + Number(l.debit), 0) * 100) / 100;

/**
 * GET /queue?companyIds=a,b,c[&includeSnoozed=true]
 * Kaikkien pyydettyjen yhtiöiden tehtävät yhtenä listana, kiireellisin ensin. Lukuoikeudella näkee,
 * mutta vain kirjoitusoikeudella voi ottaa tehtävän itselleen (ks. updateTask).
 */
export const getQueue = async (req: Request, res: Response) => {
  try {
    const raw = typeof req.query.companyIds === 'string' ? req.query.companyIds : '';
    const requested = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_COMPANIES);
    if (requested.length === 0) return res.status(400).json({ error: 'companyIds on pakollinen' });

    // Tehtävät vain yhtiöistä, joissa käyttäjä voi tehdä kirjanpitoa (hallitus ja tarkastajat eivät käsittele jonoa)
    const allowed: string[] = [];
    for (const id of requested) {
      if (roleAllows(await getCompanyRole(req, id), 'write')) allowed.push(id);
    }
    if (allowed.length === 0) return res.json([]);

    const today = new Date();
    const inCompanies = { companyId: { in: allowed } };
    const [drafts, missing, invoices, years, lastBank, tasks] = await Promise.all([
      prisma.accountingEntry.findMany({
        where: { ...inCompanies, status: EntryStatus.DRAFT },
        include: { lines: { select: { debit: true } } },
      }),
      // Kirjatut viennit, joilta puuttuu tosite (luonnokset tulevat jo tarkistettavina)
      prisma.accountingEntry.findMany({
        where: { ...inCompanies, needsVoucher: true, status: { not: EntryStatus.DRAFT } },
        include: { lines: { select: { debit: true } } },
      }),
      prisma.purchaseInvoice.findMany({ where: { ...inCompanies, status: { not: 'PAID' }, dueDate: { not: null } } }),
      prisma.fiscalYear.findMany({ where: { ...inCompanies, status: FiscalYearStatus.OPEN, endDate: { lt: today } } }),
      prisma.accountingEntry.groupBy({ by: ['companyId'], where: { ...inCompanies, createdBy: 'system-bank' }, _max: { entryDate: true } }),
      prisma.queueTask.findMany({ where: inCompanies }),
    ]);

    const items = buildQueue({
      today,
      drafts: drafts.map((e) => ({ ...e, amount: entryAmount(e.lines) })),
      missingVouchers: missing.map((e) => ({ ...e, amount: entryAmount(e.lines) })),
      invoices: invoices.map((i) => ({ ...i, totalAmount: Number(i.totalAmount) })),
      endedOpenYears: years,
      lastBankDates: allowed.map((companyId) => ({
        companyId, lastDate: lastBank.find((b) => b.companyId === companyId)?._max.entryDate ?? null,
      })),
    });

    const includeSnoozed = req.query.includeSnoozed === 'true';
    const taskOf = (companyId: string, key: string) => tasks.find((t) => t.companyId === companyId && t.itemKey === key);
    const result = items
      .map((item) => {
        const t = taskOf(item.companyId, item.key);
        return { ...item, assignedTo: t?.assignedTo ?? null, snoozedUntil: t?.snoozedUntil ?? null, note: t?.note ?? null };
      })
      .filter((i) => includeSnoozed || !isSnoozed(i.snoozedUntil, today));
    res.json(result);
  } catch (error) {
    console.error('Queue error:', error);
    res.status(500).json({ error: 'Työjonon haku epäonnistui' });
  }
};

/**
 * PUT /queue/task { companyId, itemKey, assignedTo?, snoozedUntil?, note? }
 * Kentät, jotka puuttuvat, jätetään ennalleen; null tyhjentää.
 */
export const updateTask = async (req: Request, res: Response) => {
  try {
    const { companyId, itemKey } = req.body;
    if (typeof itemKey !== 'string' || !KEY.test(itemKey)) return res.status(400).json({ error: 'Tuntematon tehtävä' });
    if (!(await assertCompanyAccess(req, res, companyId, 'write'))) return;

    const data: Record<string, unknown> = {};
    if ('assignedTo' in req.body) {
      const a = req.body.assignedTo;
      if (a !== null && typeof a !== 'string') return res.status(400).json({ error: 'assignedTo on käyttäjän tunnus tai null' });
      data.assignedTo = a;
      data.assignedBy = (req as any).user?.userId ?? null;
    }
    if ('snoozedUntil' in req.body) {
      const s = req.body.snoozedUntil;
      const d = s === null ? null : new Date(s);
      if (d && Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Virheellinen muistutuspäivä' });
      data.snoozedUntil = d;
    }
    if ('note' in req.body) {
      const n = req.body.note;
      if (n !== null && (typeof n !== 'string' || n.length > 1000)) return res.status(400).json({ error: 'Muistiinpano on liian pitkä' });
      data.note = n || null;
    }

    const task = await prisma.queueTask.upsert({
      where: { companyId_itemKey: { companyId, itemKey } },
      create: { companyId, itemKey, ...data },
      update: data,
    });
    res.json(task);
  } catch (error) {
    console.error('Queue task error:', error);
    res.status(500).json({ error: 'Tehtävän päivitys epäonnistui' });
  }
};
