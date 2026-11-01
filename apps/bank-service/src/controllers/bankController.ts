import { Request, Response } from 'express';
import { parseCamt053 } from '../services/camtParser';
import { publishBankStatementReceived } from '../utils/kafka';
import { v4 as uuidv4 } from 'uuid';

export const uploadStatement = async (req: Request, res: Response) => {
  try {
    const file = req.file;
    const { companyId, bankAccountId } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'No XML file uploaded' });
    }

    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const xmlData = file.buffer.toString('utf-8');
    const transactions = parseCamt053(xmlData);

    console.log(`Parsed ${transactions.length} transactions from CAMT.053 for company ${companyId}`);

    // Publish event for accounting-service
    await publishBankStatementReceived({
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      data: {
        companyId,
        bankAccountId: bankAccountId || 'default-account',
        transactions
      }
    });

    const incoming = transactions.filter((tx) => tx.creditDebit === 'CRDT');
    res.json({
      message: 'Bank statement processed and broadcasted',
      transactionCount: transactions.length,
      companyId,
      // Laskujen täsmäytys tapahtuu asynkronisesti invoicing-servicessä (Kafka),
      // joten tässä raportoidaan viitteelliset suoritukset, jotka lähetettiin täsmättäviksi.
      results: {
        totalTransactions: transactions.length,
        incomingPayments: incoming.length,
        matchedInvoices: incoming.filter((tx) => tx.referenceNumber).length,
      },
    });

  } catch (error) {
    console.error('Error processing bank statement:', error);
    res.status(500).json({ error: 'Failed to process bank statement' });
  }
};
