import { randomUUID } from 'crypto';
import axios from 'axios';
import { BankStatementReceivedEvent, BankTransaction } from '@ai-accountant/types';
import { prisma } from '../db';
import { ExpenseSuggestion, resolveBankAccounts } from '../bankMapping';
import { accountExists } from '../services/chartOfAccountsService';
import { findOpenFiscalYearId } from '../services/fiscalYearService';
import { serviceHeaders } from '../middleware/requireAuth';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8001/api/v1';

/**
 * Pyytää ML-palvelulta kulutiliehdotuksen lähtevälle maksulle.
 * Virhe (palvelu alhaalla tms.) ei saa kaataa kirjausta: palautetaan null => selvitettävät erät.
 */
const suggestExpenseAccount = async (companyId: string, tx: BankTransaction): Promise<ExpenseSuggestion | null> => {
  const counterparty = tx.counterpartyName || tx.payerName || '';
  try {
    const { data } = await axios.post(
      `${ML_SERVICE_URL}/ml/classify-transaction`,
      {
        description: `${counterparty} ${tx.remittanceInfo || ''}`.trim(),
        amount: tx.amount,
        date: tx.bookingDate,
        supplier: counterparty || null,
      },
      { headers: serviceHeaders(), timeout: 5000 },
    );
    const account = String(data.suggested_account);
    return {
      account,
      confidence: Number(data.confidence) || 0,
      accountExists: await accountExists(companyId, account),
    };
  } catch (err: any) {
    console.warn(`ML-luokittelu epäonnistui (${tx.entryReference}), kirjataan selvitettäviin: ${err.message}`);
    return null;
  }
};

export const handleBankStatementReceived = async (event: BankStatementReceivedEvent) => {
  const { companyId, transactions } = event.data;

  console.log(`Processing ${transactions.length} bank transactions for company ${companyId}`);

  for (const [index, tx] of transactions.entries()) {
    try {
      const counterparty = tx.counterpartyName || tx.payerName;
      const description = `Pankkitapahtuma: ${[counterparty, tx.remittanceInfo].filter(Boolean).join(' / ') || 'Nimetön'}`;
      const suggestion = tx.creditDebit === 'DBIT' ? await suggestExpenseAccount(companyId, tx) : null;
      const { debitAccount, creditAccount } = resolveBankAccounts(tx, suggestion);

      const entryDate = new Date(tx.bookingDate);
      // NtryRef on pankin yksilöivä tunniste => uniikki voucherNumber estää
      // saman tiliotteen kirjaamisen kahdesti. Varalla uniikki tunniste
      // (Date.now() toistui saman millisekunnin sisällä ja kaatoi kirjaukset).
      const voucherNumber = tx.entryReference
        ? `BANK-${tx.entryReference}`
        : `BANK-${tx.bookingDate}-${index}-${randomUUID().slice(0, 8)}`;

      const existing = await prisma.accountingEntry.findUnique({
        where: { companyId_voucherNumber: { companyId, voucherNumber } },
      });
      if (existing) {
        console.log(`Pankkitapahtuma ${voucherNumber} on jo kirjattu, ohitetaan.`);
        continue;
      }

      await prisma.accountingEntry.create({
        data: {
          companyId,
          fiscalYearId: await findOpenFiscalYearId(companyId, entryDate),
          entryDate,
          voucherNumber,
          description,
          status: 'DRAFT',
          createdBy: 'system-bank',
          lines: {
            create: [
              {
                accountNumber: debitAccount,
                debit: tx.amount,
                credit: 0,
                description: counterparty || 'Pankki',
                companyId
              },
              {
                accountNumber: creditAccount,
                debit: 0,
                credit: tx.amount,
                description: counterparty || 'Pankki',
                companyId
              }
            ]
          }
        }
      });
    } catch (err) {
      console.error(`Failed to process bank transaction ${tx.entryReference}:`, err);
    }
  }

  console.log(`Finished processing bank statement for company ${companyId}`);
};
