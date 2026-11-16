import { randomUUID } from 'crypto';
import axios from 'axios';
import { BankStatementReceivedEvent, BankTransaction } from '@ai-accountant/types';
import { isTransientDbError, prisma, TX_OPTIONS } from '../db';
import { ExpenseSuggestion, ML_CONFIDENCE_THRESHOLD, resolveBankAccounts } from '../bankMapping';
import { ACCOUNTS } from '../accounts';
import { accountExists, getAccounts } from '../services/chartOfAccountsService';
import { findOpenFiscalYearId } from '../services/fiscalYearService';
import { getLearnedAccount, messageSignature, signatureKey } from '../services/learningService';
import { matchPurchaseInvoice, supplierKey } from '../purchaseMatching';
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
        kind: 'expense', // lähtevä maksu => vain kulutilit (ei esim. 3100 Vesimaksut)
        // tilikartta tekoälyluokittelulle, jos avainsana ei osu
        accounts: (await getAccounts(companyId)).filter((a) => a.isActive).map(({ accountNumber, accountName }) => ({ accountNumber, accountName })),
      },
      { headers: serviceHeaders(), timeout: 60_000 }, // tekoälyluokittelu voi kestää
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

/**
 * Lähtevä maksu -> avoin ostolasku (viite / summa+toimittaja / yksikäsitteinen summa).
 * Osuma: D 2800 Ostovelat / K 1900 Pankki, sama tosite, lasku PAID. Palauttaa true, jos kirjattiin.
 */
const bookInvoicePayment = async (
  companyId: string, tx: BankTransaction, voucherNumber: string, description: string,
): Promise<boolean> => {
  const open = await prisma.purchaseInvoice.findMany({
    where: { companyId, status: { in: ['PROPOSED', 'BOOKED'] } },
  });
  const match = matchPurchaseInvoice(
    {
      amount: tx.amount,
      bookingDate: tx.bookingDate,
      referenceNumber: tx.referenceNumber,
      counterpartyName: tx.counterpartyName || tx.payerName,
      counterpartyIban: tx.payerIban,
    },
    open.map((inv) => ({ ...inv, totalAmount: Number(inv.totalAmount) })),
  );
  if (!match) return false;

  const { invoice, rule } = match;
  const entryDate = new Date(tx.bookingDate);
  const ruleText = rule === 1 ? 'viitenumero' : rule === 2 ? 'summa ja toimittaja' : 'summa (ainoa avoin lasku tällä summalla)';
  await prisma.$transaction(async (db) => {
    const entry = await db.accountingEntry.create({
      data: {
        companyId,
        voucherId: invoice.voucherId,
        fiscalYearId: await findOpenFiscalYearId(companyId, entryDate),
        entryDate,
        voucherNumber,
        description: `${description} (lasku ${invoice.invoiceNumber || invoice.supplierName})`,
        status: 'DRAFT',
        createdBy: 'system-bank',
        counterparty: invoice.supplierName,
        autoApprovable: rule !== 3, // pelkkä summa on heikompi peruste => tarkistettava
        reviewNote: `Täsmätty ostolaskuun: ${ruleText}`,
        lines: {
          create: [
            { accountNumber: ACCOUNTS.PAYABLES, debit: tx.amount, credit: 0, description: invoice.supplierName, companyId },
            { accountNumber: ACCOUNTS.BANK, debit: 0, credit: tx.amount, description: invoice.supplierName, companyId },
          ],
        },
      },
    });
    await db.purchaseInvoice.update({ where: { id: invoice.id }, data: { status: 'PAID', paymentEntryId: entry.id } });
  }, TX_OPTIONS);
  console.log(`Maksu ${tx.amount} € täsmätty ostolaskuun ${invoice.supplierName} ${invoice.invoiceNumber} (${ruleText})`);
  return true;
};

export const handleBankStatementReceived = async (event: BankStatementReceivedEvent) => {
  const { companyId, transactions } = event.data;

  console.log(`Processing ${transactions.length} bank transactions for company ${companyId}`);

  for (const [index, tx] of transactions.entries()) {
    try {
      const counterparty = tx.counterpartyName || tx.payerName;
      const description = `Pankkitapahtuma: ${[counterparty, tx.remittanceInfo].filter(Boolean).join(' / ') || 'Nimetön'}`;

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

      // Lähtevä maksu: ensin täsmäytys avoimeen ostolaskuun (tosite on jo kirjattu ostovelaksi)
      if (tx.creditDebit === 'DBIT' && (await bookInvoicePayment(companyId, tx, voucherNumber, description))) {
        continue;
      }

      let suggestion: ExpenseSuggestion | null = null;
      let reviewNote: string | null = null;
      let autoApprovable = false;
      if (tx.creditDebit === 'CRDT' && tx.referenceNumber) {
        // Viitesuoritus yhtiön omaan laskuun (INV-<viite>) on varma: D Pankki / K Myyntisaamiset.
        // Tuntematon viite (esim. vanhan järjestelmän lasku) kirjataan samoin, mutta tarkistettavaksi.
        const ref = String(tx.referenceNumber).replace(/\s/g, '').replace(/^0+/, '');
        const own = await prisma.accountingEntry.findFirst({
          where: { companyId, voucherNumber: { in: [`INV-${ref}`, `INV-${tx.referenceNumber}`] } },
          select: { id: true },
        });
        autoApprovable = Boolean(own);
        reviewNote = own ? 'Viitesuoritus yhtiön laskuun' : 'Viitettä ei löydy yhtiön laskuista: tarkista, mihin saatavaan suoritus kuuluu';
      }
      if (tx.creditDebit === 'DBIT') {
        // 1. opittu saaja + viesti, 2. avainsanat / tekoäly, 3. opittu saaja (vain jos saajalla aina sama tili)
        const key = supplierKey(counterparty);
        const bySignature = await getLearnedAccount(companyId, signatureKey(key, messageSignature(tx.remittanceInfo)));
        let learned: string | null = bySignature;
        if (bySignature) {
          suggestion = { account: bySignature, confidence: 1, accountExists: true };
        } else {
          suggestion = await suggestExpenseAccount(companyId, tx);
          const usable = suggestion && suggestion.accountExists && suggestion.confidence >= ML_CONFIDENCE_THRESHOLD && suggestion.account !== ACCOUNTS.SUSPENSE;
          if (!usable) {
            learned = await getLearnedAccount(companyId, key);
            if (learned) suggestion = { account: learned, confidence: 1, accountExists: true };
          }
        }
        reviewNote = `Tosite puuttuu: lataa ostolasku tai kuitti (KPL 2:5 §)${learned ? ' · tili opittu aiemmista korjauksista' : ''}`;
      }
      const { debitAccount, creditAccount } = resolveBankAccounts(tx, suggestion);

      await prisma.accountingEntry.create({
        data: {
          companyId,
          fiscalYearId: await findOpenFiscalYearId(companyId, entryDate),
          entryDate,
          voucherNumber,
          description,
          status: 'DRAFT',
          createdBy: 'system-bank',
          counterparty: counterparty || null,
          needsVoucher: tx.creditDebit === 'DBIT',
          reviewNote,
          autoApprovable,
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
      // Hetkellinen virhe: koko tiliote käsitellään uudelleen (jo kirjatut tapahtumat ohitetaan tositenumerolla)
      if (isTransientDbError(err)) throw err;
    }
  }

  console.log(`Finished processing bank statement for company ${companyId}`);
};
