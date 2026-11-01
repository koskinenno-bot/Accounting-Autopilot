import { VoucherClassifiedEvent } from '@ai-accountant/types';
import { prisma } from '../db';
import { ACCOUNTS } from '../accounts';
import { accountExists } from '../services/chartOfAccountsService';
import { findOpenFiscalYearId } from '../services/fiscalYearService';
import { getLearnedAccount } from '../services/learningService';
import { assessAutoApproval, similarNames, supplierKey } from '../purchaseMatching';

const toDate = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Luettu tosite -> ostolasku ja kirjausluonnos suoriteperusteella:
 *   D kulutili / K 2800 Ostovelat laskun päivälle (tosite linkitettynä).
 * Jos sama meno on jo kirjattu pankista ilman tositetta, tosite liitetään siihen
 * vientiin eikä kulua kirjata kahdesti.
 */
export const handleVoucherClassified = async (event: VoucherClassifiedEvent) => {
  const { voucherId, companyId, extraction, error } = event.data;

  if (!extraction) {
    // Vanha ml-worker (pelkkä tiedostonimi) tai lukuvirhe: tosite näkyy tositelistassa käsin käsiteltävänä.
    console.log(`Tositteelta ${voucherId} ei saatu tietoja${error ? `: ${error}` : ''}; kirjausta ei luoda.`);
    return;
  }
  const amount = Number(extraction.totalAmount);
  const invoiceDate = toDate(extraction.invoiceDate);
  if (!(amount > 0) || !invoiceDate || !extraction.supplierName) {
    console.log(`Tositteelta ${voucherId} puuttuu summa, päivä tai toimittaja; odottaa käsin kirjausta.`);
    return;
  }

  try {
    const key = supplierKey(extraction.supplierName, extraction.supplierBusinessId);

    // Tuplatarkistus: sama toimittaja + laskunumero, tai sama tosite jo käsitelty
    const duplicate = await prisma.purchaseInvoice.findFirst({
      where: {
        companyId,
        OR: [
          { voucherId },
          ...(extraction.invoiceNumber ? [{ supplierKey: key, invoiceNumber: extraction.invoiceNumber }] : []),
        ],
      },
    });
    if (duplicate) {
      console.log(`Tosite ${voucherId}: ostolasku ${extraction.invoiceNumber} on jo kirjattu (${duplicate.id}), ohitetaan.`);
      return;
    }

    // Pankkimeno ilman tositetta, joka vastaa tätä laskua => liitetään tosite olemassa olevaan vientiin
    const voucherless = await prisma.accountingEntry.findMany({
      where: { companyId, needsVoucher: true, voucherId: null, entryDate: { gte: invoiceDate } },
      include: { lines: true },
      orderBy: { entryDate: 'asc' },
    });
    const paidAlready = voucherless.find((e) => {
      const bankCredit = e.lines.find((l) => l.accountNumber === ACCOUNTS.BANK && Number(l.credit) > 0);
      return bankCredit && Math.round(Number(bankCredit.credit) * 100) === Math.round(amount * 100)
        && similarNames(e.counterparty, extraction.supplierName);
    });

    const base = {
      companyId,
      voucherId,
      supplierName: extraction.supplierName,
      supplierBusinessId: extraction.supplierBusinessId,
      supplierKey: key,
      invoiceNumber: extraction.invoiceNumber,
      invoiceDate,
      dueDate: toDate(extraction.dueDate),
      servicePeriodStart: toDate(extraction.servicePeriodStart),
      servicePeriodEnd: toDate(extraction.servicePeriodEnd),
      totalAmount: amount,
      vatAmount: extraction.vatAmount,
      referenceNumber: extraction.referenceNumber,
      iban: extraction.iban,
      confidence: extraction.confidence,
      extractor: extraction.extractor,
    };

    if (paidAlready) {
      const expenseLine = paidAlready.lines.find((l) => Number(l.debit) > 0);
      await prisma.$transaction([
        prisma.accountingEntry.update({
          where: { id: paidAlready.id },
          data: { voucherId, needsVoucher: false, reviewNote: paidAlready.status === 'DRAFT' ? 'Tosite liitetty, tarkista tili ja hyväksy' : null },
        }),
        prisma.purchaseInvoice.create({
          data: {
            ...base,
            expenseAccount: expenseLine?.accountNumber || ACCOUNTS.SUSPENSE,
            status: 'PAID',
            accountingEntryId: paidAlready.id,
            paymentEntryId: paidAlready.id,
          },
        }),
      ]);
      console.log(`Tosite ${voucherId} liitettiin jo kirjattuun pankkimenoon ${paidAlready.voucherNumber}`);
      return;
    }

    // Tiliöinti: opittu toimittajan tili > tekoälyn ehdotus (jos tilikartassa) > selvitettävät erät
    const learned = await getLearnedAccount(companyId, key);
    const suggested = extraction.suggestedAccount && (await accountExists(companyId, extraction.suggestedAccount))
      ? extraction.suggestedAccount : null;
    const expenseAccount = learned || suggested || ACCOUNTS.SUSPENSE;
    const { autoApprovable, issues } = assessAutoApproval(extraction, expenseAccount);

    const voucherNumber = extraction.invoiceNumber ? `OL-${key}-${extraction.invoiceNumber}` : `V-${voucherId}`;
    const description = `Ostolasku: ${extraction.supplierName}${extraction.invoiceNumber ? `, nro ${extraction.invoiceNumber}` : ''}`;

    await prisma.$transaction(async (tx) => {
      const entry = await tx.accountingEntry.create({
        data: {
          companyId,
          voucherId,
          fiscalYearId: await findOpenFiscalYearId(companyId, invoiceDate),
          entryDate: invoiceDate,
          voucherNumber,
          description,
          status: 'DRAFT',
          createdBy: `system-voucher-${extraction.extractor}`,
          counterparty: extraction.supplierName,
          autoApprovable,
          reviewNote: [learned ? `Tili opittu aiemmista korjauksista` : extraction.accountReason, ...issues]
            .filter(Boolean).join(' · ') || null,
          lines: {
            create: [
              { accountNumber: expenseAccount, debit: amount, credit: 0, description: extraction.supplierName, companyId },
              { accountNumber: ACCOUNTS.PAYABLES, debit: 0, credit: amount, description: 'Ostovelat', companyId },
            ],
          },
        },
      });
      await tx.purchaseInvoice.create({ data: { ...base, expenseAccount, accountingEntryId: entry.id } });
    });
    console.log(`Ostolasku ${extraction.supplierName} ${amount} € -> luonnos D ${expenseAccount} / K ${ACCOUNTS.PAYABLES}${autoApprovable ? ' (varma)' : ''}`);
  } catch (err) {
    console.error(`Tositteen ${voucherId} kirjaus epäonnistui:`, err);
  }
};
