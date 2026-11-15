import { InvoiceCreatedEvent, InvoiceStatusChangedEvent } from '@ai-accountant/types';
import { prisma } from '../db';
import { ACCOUNTS } from '../accounts';
import { findOpenFiscalYearId } from '../services/fiscalYearService';
import { accountExists } from '../services/chartOfAccountsService';
import { salesRevenueLines } from '../vat';

/**
 * Laskun tulorivit tileittäin. Tuntematon tai käytöstä poistettu tili kirjataan hoitovastikkeisiin,
 * jotta vienti ei kaadu (isännöitsijä näkee selitteestä alkuperäisen tilin ja voi oikaista luonnoksen).
 */
export const revenueLines = async (
  companyId: string, amount: number, lines: { accountNumber: string; amount: number; description?: string }[] | undefined,
  exists: (companyId: string, account: string) => Promise<boolean> = accountExists,
) => {
  const totalCents = Math.round(amount * 100);
  const given = (lines ?? []).filter((l) => Math.round(Number(l.amount) * 100) !== 0);
  const sum = given.reduce((s, l) => s + Math.round(Number(l.amount) * 100), 0);
  if (!given.length || sum !== totalCents) {
    return [{ accountNumber: ACCOUNTS.MAINTENANCE_FEES, cents: totalCents, description: 'Hoitovastiketulo' }];
  }
  const byAccount = new Map<string, { cents: number; description: string }>();
  for (const l of given) {
    const ok = /^\d{4,6}$/.test(String(l.accountNumber)) && (await exists(companyId, String(l.accountNumber)));
    const account = ok ? String(l.accountNumber) : ACCOUNTS.MAINTENANCE_FEES;
    const desc = ok ? (l.description || 'Vastiketulo') : `${l.description || 'Tulo'} (tili ${l.accountNumber} puuttuu tilikartasta)`;
    const prev = byAccount.get(account);
    byAccount.set(account, { cents: (prev?.cents ?? 0) + Math.round(Number(l.amount) * 100), description: prev ? `${prev.description}, ${desc}` : desc });
  }
  return [...byAccount.entries()].map(([accountNumber, v]) => ({ accountNumber, cents: v.cents, description: v.description }));
};

/**
 * Tulorivit kirjanpitoon. Verolliset rivit (vatAmount) jaetaan verottomaan tuottoon ja ALV-velkaan 2880;
 * muuten tilikohtainen yhdistely kuten ennen.
 */
export const invoiceRevenueLines = async (
  companyId: string, amount: number, lines: { accountNumber: string; amount: number; description?: string; vatRate?: number; vatAmount?: number }[] | undefined,
  exists: (companyId: string, account: string) => Promise<boolean> = accountExists,
) => {
  const taxed = (lines ?? []).some((l) => Number(l.vatAmount) > 0);
  const totalCents = Math.round(amount * 100);
  const sumCents = (lines ?? []).reduce((s, l) => s + Math.round(Number(l.amount) * 100), 0);
  if (taxed && sumCents === totalCents) {
    const checked = [];
    for (const l of lines!) {
      const ok = /^\d{4,6}$/.test(String(l.accountNumber)) && (await exists(companyId, String(l.accountNumber)));
      checked.push({
        accountNumber: ok ? String(l.accountNumber) : ACCOUNTS.MAINTENANCE_FEES,
        gross: Number(l.amount), vatRate: l.vatRate, vatAmount: l.vatAmount,
        description: ok ? (l.description || 'Tulo') : `${l.description || 'Tulo'} (tili ${l.accountNumber} puuttuu tilikartasta)`,
      });
    }
    return salesRevenueLines(checked).map(({ vatCode, vatAmount, ...l }) => ({ ...l, vatCode: vatCode ?? null, vatAmount: vatAmount ?? null }));
  }
  return (await revenueLines(companyId, amount, lines, exists)).map((l) => ({
    accountNumber: l.accountNumber, debit: 0, credit: l.cents / 100, description: l.description, vatCode: null, vatAmount: null,
  }));
};

export const handleInvoiceCreated = async (event: InvoiceCreatedEvent) => {
  const { invoiceId, companyId, amount, referenceNumber, dueDate, issueDate, lines, description } = event.data;

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

    // Myyntisaaminen syntyy laskun päiväyksellä (ei käsittelyhetkellä), muuten
    // aiemmin päivätty pankkisuoritus kuittaisi saatavaa ennen sen syntymistä.
    const entryDate = issueDate ? new Date(issueDate) : new Date();
    await prisma.accountingEntry.create({
      data: {
        companyId,
        fiscalYearId: await findOpenFiscalYearId(companyId, entryDate),
        entryDate,
        voucherNumber,
        description: `${description || 'Vastikelaskutus'} (Viite: ${referenceNumber})`,
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
            ...(await invoiceRevenueLines(companyId, amount, lines)).map((l) => ({ ...l, companyId })),
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
