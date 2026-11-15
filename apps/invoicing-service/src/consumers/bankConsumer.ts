import { BankStatementReceivedEvent } from '@ai-accountant/types';
import { prisma } from '../db';
import { recordPayment } from '../controllers/reskontraController';

const digits = (s: string) => s.replace(/\s+/g, '').replace(/^0+/, '');

/**
 * Saapuvat viitesuoritukset kohdistetaan laskuihin reskontraan. Osasuoritus jättää laskun avoimeksi
 * jäljellä olevalla summalla; sama pankkitapahtuma (arkistointitunnus) kirjataan vain kerran.
 * Kirjanpidon vienti (pankki / myyntisaamiset) syntyy accounting-servicessä samasta tiliotteesta.
 */
export const handleBankStatementReceived = async (event: BankStatementReceivedEvent) => {
  const { companyId, transactions } = event.data;

  for (const tx of transactions) {
    if (tx.creditDebit !== 'CRDT' || !tx.referenceNumber) continue;
    // Viite vertaillaan ilman välilyöntejä ja etunollia (pankit esittävät ne eri tavoin)
    const ref = digits(tx.referenceNumber);
    if (!ref) continue;
    const invoice = (await prisma.invoice.findMany({
      where: { companyId, referenceNumber: { endsWith: ref }, status: { not: 'CANCELLED' } },
    })).find((i) => digits(i.referenceNumber ?? '') === ref);
    if (!invoice) continue;
    const bankRef = tx.entryReference || `${tx.bookingDate}|${tx.amount}|${ref}`;
    const duplicate = await prisma.payment.findFirst({ where: { invoiceId: invoice.id, bankRef } });
    if (duplicate) continue;
    try {
      await recordPayment(invoice, {
        amount: Math.round(Number(tx.amount) * 100) / 100,
        paidOn: new Date(tx.bookingDate),
        source: 'BANK',
        bankRef,
        note: tx.payerName || tx.counterpartyName || null,
      });
      console.log(`Suoritus ${tx.amount} € kohdistettu laskuun ${invoice.invoiceNumber}`);
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err; // rinnakkainen käsittely ehti kirjata saman suorituksen
    }
  }
};
