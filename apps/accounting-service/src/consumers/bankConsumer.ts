import { randomUUID } from 'crypto';
import { BankStatementReceivedEvent } from '@ai-accountant/types';
import { prisma } from '../db';
import { resolveBankAccounts } from '../bankMapping';
import { findOpenFiscalYearId } from '../services/fiscalYearService';

export const handleBankStatementReceived = async (event: BankStatementReceivedEvent) => {
  const { companyId, transactions } = event.data;

  console.log(`Processing ${transactions.length} bank transactions for company ${companyId}`);

  for (const [index, tx] of transactions.entries()) {
    try {
      const description = `Pankkitapahtuma: ${tx.payerName || tx.remittanceInfo || 'Nimetön'}`;
      const { debitAccount, creditAccount } = resolveBankAccounts(tx);

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
                description: tx.payerName || 'Pankki',
                companyId
              },
              {
                accountNumber: creditAccount,
                debit: 0,
                credit: tx.amount,
                description: tx.payerName || 'Pankki',
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
