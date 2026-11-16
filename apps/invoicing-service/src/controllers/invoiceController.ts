import { Request, Response } from 'express';
import { prisma } from '../db';
import axios from 'axios';
import * as finvoiceService from '../services/finvoiceService';
import { nextInvoiceNumber, referenceFor } from '../services/invoiceNumberService';
import { assertCompanyAccess, serviceHeaders } from '../middleware/requireAuth';
import { publishInvoiceCreated, publishInvoiceStatusChanged } from '../utils/kafka';
import { v4 as uuidv4 } from 'uuid';
import { recordPayment } from './reskontraController';


const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001/api/v1';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008/api/v1';

export const createInvoice = async (req: Request, res: Response) => {
  try {
    const { companyId, recipientName, recipientEmail, recipientAddress, dueDate, issueDate, lines } = req.body;

    if (!companyId || !recipientName || !dueDate || Number.isNaN(new Date(dueDate).getTime())) {
      return res.status(400).json({ error: 'companyId, recipientName ja kelvollinen dueDate ovat pakollisia' });
    }
    // Laskupäivä (oletus tänään) määrää kirjauspäivän, esim. jälkikäteen laadittu kuukauden vuokralasku
    const issued = issueDate ? new Date(issueDate) : new Date();
    if (Number.isNaN(issued.getTime())) return res.status(400).json({ error: 'Laskupäivä on virheellinen' });
    if (new Date(dueDate) < new Date(issued.toISOString().slice(0, 10))) return res.status(400).json({ error: 'Eräpäivä on ennen laskupäivää' });
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'Laskulla on oltava vähintään yksi rivi' });
    }
    for (const [i, line] of lines.entries()) {
      const q = parseFloat(line.quantity);
      const p = parseFloat(line.unitPrice);
      if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p < 0) {
        return res.status(400).json({ error: `Rivi ${i + 1}: virheellinen määrä tai yksikköhinta` });
      }
      const v = line.vatRate === undefined || line.vatRate === null || line.vatRate === '' ? 0 : Number(line.vatRate);
      if (![0, 10, 13.5, 25.5].includes(v)) return res.status(400).json({ error: `Rivi ${i + 1}: ALV-prosentti on 0, 10, 13,5 tai 25,5` });
      if (line.accountNumber !== undefined && line.accountNumber !== null && line.accountNumber !== '' && !/^3\d{3,5}$/.test(String(line.accountNumber))) {
        return res.status(400).json({ error: `Rivi ${i + 1}: tulotili on 3000–3999-alueella (esim. 3550 liiketilojen vuokrat)` });
      }
    }

    // 1. Yhtiökohtainen juokseva laskunumero (atominen)
    const invoiceNumber = await nextInvoiceNumber(prisma, companyId);

    // 2. Viitenumero (7-3-1)
    const referenceNumber = referenceFor(companyId, invoiceNumber);

    // 3. Rivit senteissä: yksikköhinta on veroton, vero lisätään riville (ennen vero jäi laskulta pois
    //    ja kaikki kirjattiin hoitovastikkeisiin tilistä riippumatta)
    const priced = lines.map((line: any) => {
      const netCents = Math.round(parseFloat(line.unitPrice) * parseFloat(line.quantity) * 100);
      const vatRate = Number(line.vatRate) > 0 ? Number(line.vatRate) : 0;
      const vatCents = Math.round((netCents * vatRate) / 100);
      return {
        description: String(line.description ?? ''),
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatRate,
        accountNumber: line.accountNumber ? String(line.accountNumber) : '3000',
        netCents,
        vatCents,
      };
    });
    const totalAmount = priced.reduce((s: number, l: any) => s + l.netCents + l.vatCents, 0) / 100;

    // 4. Create in DB
    const invoice = await prisma.invoice.create({
      data: {
        companyId,
        invoiceNumber,
        referenceNumber,
        recipientName,
        recipientEmail,
        recipientAddress,
        issueDate: issued,
        dueDate: new Date(dueDate),
        totalAmount,
        lines: {
          create: priced.map((l: any) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            // Hoitovastikkeet ovat arvonlisäverottomia; aiempi oletus 24 % oli väärä (ja yleinen kanta on nyt 25,5 %).
            vatRate: l.vatRate,
            totalAmount: (l.netCents + l.vatCents) / 100,
            accountNumber: l.accountNumber,
          })),
        },
      },
      include: { lines: true },
    });

    // 5. Kirjanpitoon tilikohtaiset rivit (verollinen rivi jaetaan tuottoon ja ALV-velkaan)
    await publishInvoiceCreated({
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      data: {
        invoiceId: invoice.id,
        companyId: invoice.companyId,
        amount: Number(invoice.totalAmount), // Decimal -> number, muuten JSON:ssa merkkijono
        referenceNumber: invoice.referenceNumber || '',
        dueDate: invoice.dueDate.toISOString(),
        issueDate: invoice.issueDate.toISOString(),
        description: `Lasku ${invoice.invoiceNumber} ${recipientName}`,
        lines: priced.map((l: any) => ({
          accountNumber: l.accountNumber, amount: (l.netCents + l.vatCents) / 100, description: l.description,
          ...(l.vatCents ? { vatRate: l.vatRate, vatAmount: l.vatCents / 100 } : {}),
        })),
      }
    });

    res.status(201).json(invoice);

    // 5. Trigger notification (Async - don't block response)
    axios.post(`${NOTIFICATION_SERVICE_URL}/notify/email`, {
      companyId,
      recipient: invoice.recipientEmail || 'osakas@esimerkki.fi',
      subject: `Uusi vastikelasku: ${invoice.invoiceNumber}`,
      template: 'invoice-notification',
      data: {
        recipientName: invoice.recipientName,
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.totalAmount,
        dueDate: invoice.dueDate.toLocaleDateString('fi-FI'),
        referenceNumber: invoice.referenceNumber
      }
    }, { headers: serviceHeaders() }).catch(err => console.error('Delayed notification error:', err.message));

  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
};

export const getInvoices = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ error: 'companyId is required' });
    const invoices = await prisma.invoice.findMany({
      where: { companyId: companyId as string },
      include: { lines: true, payments: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
};

export const getFinvoiceXml = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { lines: true },
    });

    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (!(await assertCompanyAccess(req, res, invoice.companyId))) return;

    // Myyjän tiedot yhtiöltä (käyttäjän omalla tunnisteella: näkyy vain, jos käyttäjä näkee yhtiön)
    let company: any = null;
    try {
      const { data } = await axios.get(`${USER_SERVICE_URL}/companies`, { headers: { Authorization: req.headers.authorization || '' }, timeout: 5_000 });
      company = Array.isArray(data) ? data.find((c: any) => c?.id === invoice.companyId) : null;
    } catch { /* käsitellään alla */ }
    if (!company) return res.status(502).json({ error: 'Yhtiön tietoja ei saatu haettua' });
    const iban = company.settings?.iban;
    if (typeof iban !== 'string' || !iban) {
      return res.status(409).json({ error: 'Yhtiön tilinumero puuttuu. Lisää se yhtiön tietoihin ennen Finvoice-aineiston muodostamista.' });
    }
    const xml = finvoiceService.generateFinvoiceXml({
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate.toISOString().split('T')[0],
      dueDate: invoice.dueDate.toISOString().split('T')[0],
      sellerName: company.name,
      sellerBusinessId: company.businessId,
      sellerIban: iban,
      buyerName: invoice.recipientName,
      totalAmount: Number(invoice.totalAmount),
      currency: invoice.currency,
      referenceNumber: invoice.referenceNumber || '',
      lines: invoice.lines.map((l: any) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        vatRate: Number(l.vatRate),
        totalAmount: Number(l.totalAmount),
      })),
    });

    res.header('Content-Type', 'application/xml; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="finvoice-${String(invoice.invoiceNumber).replace(/[^\w-]/g, '_')}.xml"`)
      .send(xml);
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate XML' });
  }
};

// Sallitut tilasiirtymät. PAID ja CANCELLED ovat lopputiloja (maksettua laskua ei avata uudelleen täältä).
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['PAID', 'OVERDUE', 'CANCELLED'],
  OVERDUE: ['PAID', 'CANCELLED'],
  PAID: [],
  CANCELLED: [],
};

/**
 * Laskun tilan muutos käsin, esim. viitteetön suoritus kohdistetaan laskuun.
 * Kirjanpitoon ei synny tästä uutta vientiä: kohdistettu pankkivienti kuittaa saatavan.
 */
export const updateInvoiceStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status || !(status in ALLOWED_TRANSITIONS)) {
      return res.status(400).json({ error: `Virheellinen tila: ${status}` });
    }

    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return res.status(404).json({ error: 'Laskua ei löydy' });
    if (!(await assertCompanyAccess(req, res, invoice.companyId))) return;
    if (!ALLOWED_TRANSITIONS[invoice.status].includes(status)) {
      return res.status(409).json({ error: `Laskun tilaa ei voi muuttaa: ${invoice.status} -> ${status}` });
    }

    // Maksetuksi merkintä käsin = suoritus jäljellä olevalle summalle, jotta reskontran saldo täsmää
    const open = Math.round((Number(invoice.totalAmount) - Number(invoice.paidAmount)) * 100) / 100;
    if (status === 'PAID' && open > 0) {
      const paid = await recordPayment(invoice, {
        amount: open, paidOn: new Date(), source: 'MANUAL', note: 'Merkitty maksetuksi', createdBy: (req as any).user?.userId ?? null,
      });
      return res.json(paid);
    }

    const updated = await prisma.invoice.update({ where: { id }, data: { status } });

    await publishInvoiceStatusChanged({
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      data: { invoiceId: updated.id, companyId: updated.companyId, status: updated.status },
    });

    res.json(updated);
  } catch (error) {
    console.error('Update invoice status error:', error);
    res.status(500).json({ error: 'Laskun tilan päivitys epäonnistui' });
  }
};

export const generateBulkMaintenanceFees = async (req: Request, res: Response) => {
  try {
    const { companyId, unitPrice, dueDate, description, issueDate } = req.body;
    if (!companyId || !(parseFloat(unitPrice) > 0) || Number.isNaN(new Date(dueDate).getTime())) {
      return res.status(400).json({ error: 'companyId, positiivinen unitPrice ja kelvollinen dueDate ovat pakollisia' });
    }
    // Valinnainen laskupäivä (esim. kuukauden vastikeajo tehdään etukäteen); oletus tänään
    const issued = issueDate ? new Date(issueDate) : new Date();
    if (Number.isNaN(issued.getTime())) {
      return res.status(400).json({ error: 'Virheellinen issueDate' });
    }

    // 1. Fetch shareholders from User Service
    // Välitetään käyttäjän oma tunniste, jolloin user-service tarkistaa myös yhtiön käyttöoikeuden.
    const shareholdersRes = await axios.get(`${USER_SERVICE_URL}/shareholders`, {
      params: { companyId },
      headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
    });
    const shareholders = shareholdersRes.data;

    const createdInvoices = [];

    for (const sh of shareholders) {
      for (const share of sh.shares) {
        // Calculate amount: unitPrice * sqm (simple logic for MVP)
        const sqm = share.apartment?.squareMeters || 0;
        const totalAmount = Math.round(parseFloat(unitPrice) * parseFloat(sqm) * 100) / 100;

        if (!(totalAmount > 0)) continue;

        const invoiceNumber = await nextInvoiceNumber(prisma, companyId);
        const referenceNumber = referenceFor(companyId, invoiceNumber);

        const invoice = await prisma.invoice.create({
          data: {
            companyId,
            invoiceNumber,
            referenceNumber,
            recipientName: sh.companyName || `${sh.firstName} ${sh.lastName}`,
            recipientEmail: sh.email,
            issueDate: issued,
            dueDate: new Date(dueDate),
            totalAmount,
            status: 'SENT',
            lines: {
              create: [{
                description: description || 'Hoitovastike',
                quantity: sqm,
                unitPrice: unitPrice,
                vatRate: 0, // hoitovastike on arvonlisäverotonta (AVL 28 §)
                totalAmount: totalAmount,
              }]
            }
          }
        });

        // Publish event
        await publishInvoiceCreated({
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          data: {
            invoiceId: invoice.id,
            companyId,
            amount: totalAmount,
            referenceNumber: invoice.referenceNumber || '',
            dueDate: invoice.dueDate.toISOString(),
            issueDate: invoice.issueDate.toISOString()
          }
        });

        createdInvoices.push(invoice);
      }
    }

    res.json({ 
      message: `Successfully generated ${createdInvoices.length} invoices`,
      count: createdInvoices.length 
    });

  } catch (error) {
    console.error('Bulk invoice error:', error);
    res.status(500).json({ error: 'Failed to generate bulk invoices' });
  }
};
