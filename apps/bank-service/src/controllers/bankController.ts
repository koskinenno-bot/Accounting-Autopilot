import { Request, Response } from 'express';
import { importStatement, StatementError } from '../services/statementImporter';

/** Tiliotteen lataus: camt.053 (XML), pankin CSV tai PDF (tekoälyluku). Muoto tunnistetaan sisällöstä. */
export const uploadStatement = async (req: Request, res: Response) => {
  try {
    const file = req.file;
    const { companyId, bankAccountId } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'Tiliotetiedosto puuttuu' });
    }

    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const result = await importStatement(companyId, file.buffer, file.originalname, bankAccountId);
    // Laskujen täsmäytys ja kirjaukset tapahtuvat asynkronisesti (Kafka).
    res.json({ message: 'Bank statement processed and broadcasted', companyId, ...result });
  } catch (error) {
    if (error instanceof StatementError) return res.status(error.status).json({ error: error.message });
    console.error('Error processing bank statement:', error);
    res.status(500).json({ error: 'Failed to process bank statement' });
  }
};
