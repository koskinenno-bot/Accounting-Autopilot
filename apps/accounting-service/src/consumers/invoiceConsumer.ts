import { InvoiceCreatedEvent, InvoiceStatusChangedEvent } from '@ai-accountant/types';
import { prisma } from '../db';
import { ACCOUNTS } from '../accounts';
import { findOpenFiscalYearId } from '../services/fiscalYearService';

export const handleInvoiceCreated = async (event: InvoiceCreatedEvent) => {
  const { invoiceId, companyId, amount, referenceNumber, dueDate } = event.data;

  console.log(`Creating accounting entry for new invoice: ${invoiceId}`);

  try {
    const voucherNumber = `INV-${referenceNumber}`;
    const existing = await prisma.accountingEntry.findUnique({
      where: { companyId_voucherNumber: { companyId, voucherNumber } },
    });
    if (existing) {
      console.log(`Lasku ${invoiceId} on jo kirjattu (${voucherNumber}), ohitetaan.`);
      return;
    }

    const entryDate = new Date();
    await prisma.accountingEntry.create({
      data: {
        companyId,
        fiscalYearId: await findOpenFiscalYearId(companyId, entryDate),
        entryDate,
        voucherNumber,
        description: `Vastikelaskutus (Viite: ${referenceNumber})`,
        status: 'DRAFT',
        createdBy: 'system-invoicing',
        lines: {
          create: [
            {
              accountNumber: ACCOUNTS.RECEIVABLES, // Myyntisaamiset
              debit: amount,
              credit: 0,
              description: `Vastikesuoritus (eräpäivä ${new Date(dueDate).toLocaleDateString('fi-FI')})`,
              companyId
            },
            {
              accountNumber: ACCOUNTS.MAINTENANCE_FEES, // Hoitovastikkeet
              debit: 0,
              credit: amount,
              description: 'Hoitovastiketulo',
              companyId
            }
          ]
        }
      }
    });
  } catch (error) {
    console.error('Invoice account entry error:', error);
  }
};

export const handleInvoicePaid = async (event: InvoiceStatusChangedEvent) => {
  if (event.data.status !== 'PAID') return;
  
  const { invoiceId } = event.data;
  console.log(`Invoice ${invoiceId} marked as PAID. Accounting will be settled via Bank Statement automation.`);
  // NOTE: In a more complex ledger, we would link the bank entry to the specific receivable here.
  // For MVP, the bank automation already creates the Bank/Receivable entry when it sees the reference number.
};
