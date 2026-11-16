import { Request, Response } from 'express';
import axios from 'axios';
import { prisma } from '../db';
import { virtualBarcode } from '../barcode';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001/api/v1';

/**
 * GET /invoices/portal : osakasportaalin laskut. Huoneistot ja yhtiöt haetaan user-servicestä käyttäjän omalla
 * tunnisteella (GET /portal/me), joten osakas näkee vain omien huoneistojensa laskut, jotka on osoitettu
 * huoneiston nykyisille omistajille (edellisen omistajan laskut eivät näy). Ei vaadi yhtiöroolia.
 */
export const getPortalInvoices = async (req: Request, res: Response) => {
  try {
    const { data: me } = await axios.get(`${USER_SERVICE_URL}/portal/me`, {
      headers: { Authorization: req.headers.authorization || '' }, timeout: 15_000,
    });
    const today = new Date();
    const companies = [];
    for (const c of me.companies ?? []) {
      const apartments: string[] = [...new Set<string>((c.apartments ?? []).map((a: any) => a.apartment))];
      if (!apartments.length) continue;
      const invoices = await prisma.invoice.findMany({
        where: { companyId: c.companyId, apartment: { in: apartments }, status: { not: 'CANCELLED' } },
        include: { lines: true, payments: { orderBy: { paidOn: 'asc' } } },
        orderBy: [{ dueDate: 'desc' }, { invoiceNumber: 'desc' }],
      });
      const owners = new Map<string, Set<string>>(
        (c.apartments ?? []).map((a: any) => [a.apartment, new Set((a.ownerEmails ?? []).map((e: string) => e.toLowerCase()))]),
      );
      const visible = invoices.filter((i) => {
        const emails = owners.get(String(i.apartment));
        return emails && i.recipientEmail && emails.has(i.recipientEmail.toLowerCase());
      });
      const rows = visible.map((i) => {
        const total = Number(i.totalAmount);
        const paid = Number(i.paidAmount);
        const open = Math.max(0, Math.round((total - paid) * 100) / 100);
        return {
          id: i.id, invoiceNumber: i.invoiceNumber, apartment: i.apartment, period: i.period, kind: i.kind,
          issueDate: i.issueDate, dueDate: i.dueDate, totalAmount: total, paidAmount: paid, open,
          overdue: open > 0 && i.dueDate < today, status: i.status, referenceNumber: i.referenceNumber,
          lines: i.lines.map((l) => ({ description: l.description, amount: Number(l.totalAmount) })),
          payments: i.payments.map((p) => ({ amount: Number(p.amount), paidOn: p.paidOn })),
          barcode: open > 0 && c.iban && i.referenceNumber ? virtualBarcode(c.iban, open, i.referenceNumber, i.dueDate) : null,
        };
      });
      companies.push({
        companyId: c.companyId, companyName: c.companyName, iban: c.iban, bic: c.bic, apartments,
        openTotal: Math.round(rows.reduce((s, r) => s + r.open, 0) * 100) / 100,
        overdueTotal: Math.round(rows.filter((r) => r.overdue).reduce((s, r) => s + r.open, 0) * 100) / 100,
        invoices: rows,
      });
    }
    res.json({ user: me.user, companies });
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 401) return res.status(401).json({ error: 'Kirjaudu uudelleen' });
    console.error('Osakasportaalin laskujen haku epäonnistui:', err?.message);
    res.status(502).json({ error: 'Laskujen haku epäonnistui' });
  }
};
