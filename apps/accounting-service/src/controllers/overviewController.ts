import { Request, Response } from 'express';
import { EntryStatus, FiscalYearStatus } from '../../prisma/client';
import { prisma } from '../db';
import { hasCompanyAccess } from '../middleware/requireAuth';

const MAX_COMPANIES = 200;

/**
 * Isännöitsijän yleisnäkymä: tilanne kaikista pyydetyistä yhtiöistä yhdellä kutsulla.
 * GET /overview?companyIds=a,b,c  -> [{ companyId, pending, needsVoucher, autoApprovable, overdueInvoices,
 *                                       lastBankDate, openFiscalYear }]
 * Yhtiöt, joihin käyttäjällä ei ole pääsyä, jätetään pois hiljaa (lista tulee dashboardin yhtiölistasta).
 */
export const getOverview = async (req: Request, res: Response) => {
  try {
    const raw = typeof req.query.companyIds === 'string' ? req.query.companyIds : '';
    const requested = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_COMPANIES);
    if (requested.length === 0) return res.status(400).json({ error: 'companyIds on pakollinen' });

    const allowed: string[] = [];
    for (const id of requested) {
      if (await hasCompanyAccess(req, id, 'read')) allowed.push(id);
    }
    if (allowed.length === 0) return res.json([]);

    const draft = { companyId: { in: allowed }, status: EntryStatus.DRAFT };
    const today = new Date();
    const [pending, needsVoucher, autoApprovable, overdue, lastBank, openYears] = await Promise.all([
      prisma.accountingEntry.groupBy({ by: ['companyId'], where: draft, _count: { _all: true } }),
      prisma.accountingEntry.groupBy({ by: ['companyId'], where: { companyId: { in: allowed }, needsVoucher: true }, _count: { _all: true } }),
      prisma.accountingEntry.groupBy({ by: ['companyId'], where: { ...draft, autoApprovable: true }, _count: { _all: true } }),
      prisma.purchaseInvoice.groupBy({
        by: ['companyId'],
        where: { companyId: { in: allowed }, status: { not: 'PAID' }, dueDate: { lt: today } },
        _count: { _all: true },
      }),
      prisma.accountingEntry.groupBy({
        by: ['companyId'], where: { companyId: { in: allowed }, createdBy: 'system-bank' }, _max: { entryDate: true },
      }),
      prisma.fiscalYear.findMany({
        where: { companyId: { in: allowed }, status: FiscalYearStatus.OPEN },
        orderBy: { startDate: 'asc' },
      }),
    ]);

    const count = (rows: { companyId: string; _count: { _all: number } }[], id: string) =>
      rows.find((r) => r.companyId === id)?._count._all ?? 0;

    res.json(allowed.map((companyId) => {
      const fy = openYears.find((y) => y.companyId === companyId); // vanhin avoin tilikausi
      return {
        companyId,
        pending: count(pending, companyId),
        needsVoucher: count(needsVoucher, companyId),
        autoApprovable: count(autoApprovable, companyId),
        overdueInvoices: count(overdue, companyId),
        lastBankDate: lastBank.find((r) => r.companyId === companyId)?._max.entryDate ?? null,
        openFiscalYear: fy ? { id: fy.id, startDate: fy.startDate, endDate: fy.endDate } : null,
        // Tilikausi päättynyt, mutta ei suljettu => tilinpäätös myöhässä tai työn alla
        closingDue: fy ? fy.endDate < today : false,
      };
    }));
  } catch (error) {
    console.error('Overview error:', error);
    res.status(500).json({ error: 'Yleisnäkymän haku epäonnistui' });
  }
};
