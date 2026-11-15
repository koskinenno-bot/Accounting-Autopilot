import { Request, Response } from 'express';
import axios from 'axios';
import { EntryStatus } from '../../prisma/client';
import { prisma } from '../db';
import { serviceHeaders } from '../middleware/requireAuth';
import { buildVoucherRequest } from '../voucherRequests';

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008/api/v1';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001/api/v1';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const entryAmount = (lines: { debit: unknown }[]) =>
  Math.round(lines.reduce((s, l) => s + Number(l.debit), 0) * 100) / 100;

const missingWhere = (companyId: string) => ({ companyId, needsVoucher: true, status: { not: EntryStatus.DRAFT } });

/** GET /missing-vouchers?companyId= -> kirjatut pankkimenot ilman tositetta. */
export const listMissing = async (req: Request, res: Response) => {
  try {
    const companyId = req.query.companyId as string;
    const rows = await prisma.accountingEntry.findMany({
      where: missingWhere(companyId), include: { lines: { select: { debit: true } } }, orderBy: { entryDate: 'asc' },
    });
    res.json(rows.map((e) => ({
      id: e.id, entryDate: e.entryDate, amount: entryAmount(e.lines), counterparty: e.counterparty, description: e.description,
      voucherRequestedAt: e.voucherRequestedAt, voucherRequestedFrom: e.voucherRequestedFrom,
    })));
  } catch (error) {
    console.error('Missing vouchers error:', error);
    res.status(500).json({ error: 'Puuttuvien tositteiden haku epäonnistui' });
  }
};

/**
 * POST /missing-vouchers/request { companyId, recipient, replyTo?, entryIds?, message? }
 * Lähettää listan puuttuvista tositteista sähköpostilla ja merkitsee viennit pyydetyiksi.
 */
export const requestMissing = async (req: Request, res: Response) => {
  try {
    const { companyId, recipient, replyTo, entryIds, message } = req.body ?? {};
    if (typeof recipient !== 'string' || !EMAIL.test(recipient.trim())) return res.status(400).json({ error: 'Virheellinen vastaanottajan sähköposti' });
    if (replyTo !== undefined && replyTo !== null && replyTo !== '' && (typeof replyTo !== 'string' || !EMAIL.test(replyTo.trim()))) {
      return res.status(400).json({ error: 'Virheellinen vastausosoite' });
    }
    const where: any = missingWhere(companyId);
    if (Array.isArray(entryIds) && entryIds.length) where.id = { in: entryIds.filter((x: unknown) => typeof x === 'string') };
    const rows = await prisma.accountingEntry.findMany({ where, include: { lines: { select: { debit: true } } } });
    if (rows.length === 0) return res.status(400).json({ error: 'Ei puuttuvia tositteita' });

    // Yhtiön nimi viestiin (käyttäjän omalla tunnisteella, ei paljasteta muuta)
    let companyName = 'Taloyhtiö';
    try {
      const { data } = await axios.get(`${USER_SERVICE_URL}/companies`, {
        headers: { Authorization: req.headers.authorization || '' }, timeout: 5_000,
      });
      const found = Array.isArray(data) ? data.find((c: any) => c?.id === companyId) : null;
      if (typeof found?.name === 'string') companyName = found.name;
    } catch { /* nimi ei ole välttämätön */ }

    const mail = buildVoucherRequest(companyName, rows.map((e) => ({ ...e, amount: entryAmount(e.lines) })), message);
    try {
      await axios.post(`${NOTIFICATION_SERVICE_URL}/notify/email`, {
        companyId, recipient: recipient.trim(), replyTo: typeof replyTo === 'string' && replyTo.trim() ? replyTo.trim() : undefined,
        subject: mail.subject, data: { body: mail.body },
      }, { headers: serviceHeaders(), timeout: 15_000 });
    } catch (err: any) {
      const detail = err?.response?.data?.error || err?.message;
      return res.status(502).json({ error: `Sähköpostin lähetys epäonnistui: ${detail}` });
    }
    await prisma.accountingEntry.updateMany({
      where: { id: { in: mail.ids } },
      data: { voucherRequestedAt: new Date(), voucherRequestedFrom: recipient.trim().slice(0, 200) },
    });
    res.json({ requested: mail.count });
  } catch (error) {
    console.error('Voucher request error:', error);
    res.status(500).json({ error: 'Pyynnön lähetys epäonnistui' });
  }
};
