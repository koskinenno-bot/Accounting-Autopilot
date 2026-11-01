import { Request, Response } from 'express';
import { PrismaClient } from '../../prisma/client';
import axios from 'axios';
import * as finvoiceService from '../services/finvoiceService';
import { nextInvoiceNumber, referenceFor } from '../services/invoiceNumberService';
import { serviceHeaders } from '../middleware/requireAuth';
import { publishInvoiceCreated, publishInvoiceStatusChanged } from '../utils/kafka';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001/api/v1';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008/api/v1';

export const createInvoice = async (req: Request, res: Response) => {
  try {
    const { companyId, recipientName, recipientEmail, recipientAddress, dueDate, lines } = req.body;

    if (!companyId || !recipientName || !dueDate || Number.isNaN(new Date(dueDate).getTime())) {
      return res.status(400).json({ error: 'companyId, recipientName ja kelvollinen dueDate ovat pakollisia' });
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'Laskulla on oltava vähintään yksi rivi' });
    }
    for (const [i, line] of lines.entries()) {
      const q = parseFloat(line.quantity);
      const p = parseFloat(line.unitPrice);
      if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p < 0) {
        return res.status(400).json({ error: `Rivi ${i + 1}: virheellinen määrä tai yksikköhinta` });
      }
    }

    // 1. Yhtiökohtainen juokseva laskunumero (atominen)
    const invoiceNumber = await nextInvoiceNumber(prisma, companyId);

    // 2. Viitenumero (7-3-1)
    const referenceNumber = referenceFor(companyId, invoiceNumber);

    // 3. Summa senteissä pyöristettynä (vältetään liukulukuvirheet)
    const lineTotal = (line: any) => Math.round(parseFloat(line.unitPrice) * parseFloat(line.quantity) * 100) / 100;
    const totalAmount = Math.round(lines.reduce((sum: number, line: any) => sum + lineTotal(line), 0) * 100) / 100;

    // 4. Create in DB
    const invoice = await prisma.invoice.create({
      data: {
        companyId,
        invoiceNumber,
        referenceNumber,
        recipientName,
        recipientEmail,
        recipientAddress,
        dueDate: new Date(dueDate),
        totalAmount,
        lines: {
          create: lines.map((line: any) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            // Hoitovastikkeet ovat arvonlisäverottomia; aiempi oletus 24 % oli väärä (ja yleinen kanta on nyt 25,5 %).
            vatRate: line.vatRate ?? 0,
            totalAmount: lineTotal(line),
          })),
        },
      },
      include: { lines: true },
    });

    // 5. Publish event for accounting
    await publishInvoiceCreated({
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      data: {
        invoiceId: invoice.id,
        companyId: invoice.companyId,
        amount: Number(invoice.totalAmount), // Decimal -> number, muuten JSON:ssa merkkijono
        referenceNumber: invoice.referenceNumber || '',
        dueDate: invoice.dueDate.toISOString()
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
      include: { lines: true },
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

    // Mock company data (in real app, fetch from User Service)
    const xml = finvoiceService.generateFinvoiceXml({
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate.toISOString().split('T')[0],
      dueDate: invoice.dueDate.toISOString().split('T')[0],
      sellerName: 'Malliyhtiö Oy',
      sellerBusinessId: '1234567-8',
      sellerIban: 'FI1234567890123456',
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

    res.header('Content-Type', 'application/xml').send(xml);
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate XML' });
  }
};

export const generateBulkMaintenanceFees = async (req: Request, res: Response) => {
  try {
    const { companyId, unitPrice, dueDate, description } = req.body;

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
            dueDate: invoice.dueDate.toISOString()
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
