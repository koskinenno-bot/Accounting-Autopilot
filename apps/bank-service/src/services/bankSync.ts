import { v4 as uuidv4 } from 'uuid';
import { BankTransaction } from './camtParser';
import { BankApiError, EnableBankingClient, fetchAllTransactions, mapTransaction, pickBalance, syncDateFrom } from './enableBanking';

export interface SyncAccountInput {
  companyId: string;
  uid: string;
  iban?: string | null;
  syncFrom: Date;
  lastBookingDate?: Date | null;
}
export interface SyncAccountResult { imported: number; lastBookingDate: Date | null; balance: number | null }

/** Jo välitettyjen tapahtumien kirjanpito (tietokanta); testeissä muistissa. */
export interface SeenStore {
  filterNew: (refs: string[]) => Promise<Set<string>>;
  markSent: (txs: BankTransaction[]) => Promise<void>;
}

type Publish = (event: { id: string; timestamp: string; data: { companyId: string; bankAccountId: string; transactions: BankTransaction[] } }) => Promise<boolean>;

/**
 * Hakee tilin tapahtumat ja välittää ne samaan käsittelyyn kuin tiliotetiedostot (kirjanpito + reskontra).
 * Päällekkäinen hakujakso on turvallinen: kirjanpito ohittaa jo kirjatut arkistointitunnukset.
 * Jos välitys epäonnistuu, heitetään virhe eikä hakukohtaa siirretä.
 */
export const syncAccount = async (
  client: Pick<EnableBankingClient, 'transactionsPage' | 'balances'>, input: SyncAccountInput, publish: Publish, seen?: SeenStore,
): Promise<SyncAccountResult> => {
  const dateFrom = syncDateFrom(input.lastBookingDate, input.syncFrom);
  const raw = await fetchAllTransactions(client, input.uid, dateFrom);
  const fromIso = input.syncFrom.toISOString().slice(0, 10);
  const fetched = raw.map((t) => mapTransaction(t, input.uid))
    .filter((t): t is BankTransaction => !!t && t.bookingDate >= fromIso)
    .sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
  const fresh = seen ? await seen.filterNew(fetched.map((t) => t.entryReference!)) : null;
  const transactions = fresh ? fetched.filter((t) => fresh.has(t.entryReference!)) : fetched;

  let lastBookingDate = input.lastBookingDate ?? null;
  if (transactions.length) {
    const ok = await publish({
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      data: { companyId: input.companyId, bankAccountId: input.iban || input.uid, transactions },
    });
    if (!ok) throw new BankApiError(503, 'Tapahtumia ei saatu välitettyä kirjanpitoon (Kafka ei vastaa). Yritä uudelleen.');
    await seen?.markSent(transactions);
  }
  if (fetched.length) {
    const latest = new Date(`${fetched[fetched.length - 1].bookingDate}T00:00:00Z`);
    if (!lastBookingDate || latest > lastBookingDate) lastBookingDate = latest;
  }

  let balance: number | null = null;
  try {
    balance = pickBalance((await client.balances(input.uid)).balances);
  } catch (err: any) {
    console.warn(`Saldon haku epäonnistui (${input.uid}): ${err.message}`);
  }
  return { imported: transactions.length, lastBookingDate, balance };
};
