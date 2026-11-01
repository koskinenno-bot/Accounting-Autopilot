import { VoucherClassifiedEvent } from '@ai-accountant/types';
import { prisma } from '../db';
import { ACCOUNTS } from '../accounts';
import { accountExists } from '../services/chartOfAccountsService';
import { findOpenFiscalYearId } from '../services/fiscalYearService';

export const handleVoucherClassified = async (event: VoucherClassifiedEvent) => {
  const data = event.data as VoucherClassifiedEvent['data'] & { suggested_account?: string };
  const { voucherId, companyId, amount, supplier } = data;
  // Hyväksytään myös vanha snake_case-kenttä, jota ml-worker lähetti aiemmin.
  const suggested = data.suggestedAccount || data.suggested_account;

  console.log(`Creating draft accounting entry for voucher ${voucherId}`);

  if (!amount || !(Number(amount) > 0)) {
    // Ilman summaa (OCR ei vielä käytössä) ei luoda nollavientiä; tosite odottaa käsin kirjausta.
    console.log(`Tositteella ${voucherId} ei ole summaa, kirjausluonnosta ei luoda.`);
    return;
  }

  try {
    // ML-palvelun ehdottamaa tiliä ei välttämättä ole yhtiön tilikartassa
    // (esim. 5000/9999). Silloin kirjataan selvitettäviin eriin eikä
    // koko kirjaus kaadu viite-eheysvirheeseen.
    const expenseAccount =
      suggested && (await accountExists(companyId, suggested)) ? suggested : ACCOUNTS.SUSPENSE;
    if (expenseAccount !== suggested) {
      console.warn(`Ehdotettua tiliä ${suggested} ei löydy yhtiön ${companyId} tilikartasta, käytetään ${ACCOUNTS.SUSPENSE}`);
    }

    const voucherNumber = `V-${voucherId}`;
    const existing = await prisma.accountingEntry.findUnique({
      where: { companyId_voucherNumber: { companyId, voucherNumber } },
    });
    if (existing) {
      console.log(`Tosite ${voucherId} on jo kirjattu, ohitetaan.`);
      return;
    }

    const entryDate = data.date ? new Date(data.date) : new Date();
    const entry = await prisma.accountingEntry.create({
      data: {
        companyId,
        voucherId,
        fiscalYearId: await findOpenFiscalYearId(companyId, entryDate),
        entryDate,
        voucherNumber,
        description: `Automated entry for: ${supplier || 'Unknown Supplier'}`,
        status: 'DRAFT',
        createdBy: 'system-ml',
        lines: {
          create: [
            {
              accountNumber: expenseAccount,
              debit: amount || 0,
              credit: 0,
              description: supplier || 'Expense',
              companyId
            },
            {
              accountNumber: ACCOUNTS.PAYABLES,
              debit: 0,
              credit: amount || 0,
              description: 'Ostovelat',
              companyId
            }
          ]
        }
      }
    });

    console.log(`Successfully created draft entry ${entry.id} for company ${companyId}`);
  } catch (error) {
    console.error(`Failed to create accounting entry for voucher ${voucherId}:`, error);
  }
};
