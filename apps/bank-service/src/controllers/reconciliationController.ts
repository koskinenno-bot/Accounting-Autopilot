import { Request, Response } from 'express';
import axios from 'axios';
import * as camtParser from '../services/camtParser';

/**
 * HUOM: Tätä controlleria ei ole reititetty. Varsinainen tiliotteiden käsittely
 * kulkee Kafkan kautta (bankController -> bank.statement.received), jossa sekä
 * laskun kuittaus että kirjanpitovienti tehdään. Tämän reitittäminen
 * kirjaisi suoritukset kahteen kertaan.
 */

const INVOICING_SERVICE_URL = process.env.INVOICING_SERVICE_URL || 'http://localhost:3004/api/v1';
const ACCOUNTING_SERVICE_URL = process.env.ACCOUNTING_SERVICE_URL || 'http://localhost:3002/api/v1';

export const processStatement = async (req: Request, res: Response) => {
  try {
    const file = req.file;
    const { companyId } = req.body;
    const authHeaders = req.headers.authorization ? { Authorization: req.headers.authorization } : {};

    if (!file) return res.status(400).json({ error: 'No statement file uploaded' });

    const xmlData = file.buffer.toString('utf-8');
    const transactions = camtParser.parseCamt053(xmlData);
    
    const results = {
      totalTransactions: transactions.length,
      matchedInvoices: 0,
      errors: [] as string[],
    };

    for (const tx of transactions) {
      if (tx.creditDebit === 'CRDT' && tx.referenceNumber) {
        try {
          // 1. Try to find and match invoice in Invoicing Service
          // In a real app, this would be a more robust internal API call
          const invoicesRes = await axios.get(`${INVOICING_SERVICE_URL}/invoices`, {
            params: { companyId },
            headers: authHeaders,
          });
          const matchingInvoice = invoicesRes.data.find((inv: any) => inv.referenceNumber === tx.referenceNumber);

          if (matchingInvoice && matchingInvoice.status !== 'PAID') {
            // 2. Mark as paid (simplified for MVP - in reality, check amounts)
            // await axios.patch(`${INVOICING_SERVICE_URL}/invoices/${matchingInvoice.id}`, { status: 'PAID' });
            
            // 3. Create Accounting Entry (Bank transaction)
            await axios.post(`${ACCOUNTING_SERVICE_URL}/accounting/entries`, {
              companyId,
              entryDate: tx.bookingDate,
              description: `Suoritus: ${tx.payerName || ''} (Viite ${tx.referenceNumber})`,
              voucherNumber: `BANK-${tx.entryReference || tx.referenceNumber}`,
              lines: [
                { accountNumber: '1900', debit: tx.amount, credit: 0 }, // Pankkitili
                { accountNumber: '1700', debit: 0, credit: tx.amount }, // Myyntisaamiset
              ]
            }, { headers: authHeaders });

            results.matchedInvoices++;
          }
        } catch (err: any) {
          console.error(`Error matching transaction ${tx.referenceNumber}:`, err.message);
          results.errors.push(`Failed matching ref ${tx.referenceNumber}`);
        }
      }
    }

    res.json({ message: 'Statement processed', results });
  } catch (error) {
    console.error('Process statement error:', error);
    res.status(500).json({ error: 'Failed to process statement' });
  }
};
