import { ACCOUNTS } from './accounts';

export interface BankTxLike {
  creditDebit: 'CRDT' | 'DBIT';
  referenceNumber?: string;
}

/** ML-palvelun tiliöintiehdotus lähtevälle maksulle. */
export interface ExpenseSuggestion {
  account: string;
  confidence: number;
  /** Onko tili yhtiön tilikartassa (tarkistettu kutsujan toimesta). */
  accountExists: boolean;
}

/** Tätä pienemmällä varmuudella ML-ehdotus ei kelpaa, vaan maksu jää selvitettäviin. */
export const ML_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Pankkitapahtuman tiliöinti:
 *  - Saapuva maksu viitteellä => D Pankki / K Myyntisaamiset
 *    (vastikelasku on jo kirjattu D Myyntisaamiset / K Hoitovastikkeet,
 *    joten tulon kirjaaminen uudestaan kahdentaisi vastiketuotot).
 *  - Saapuva maksu ilman viitettä => D Pankki / K Selvitettävät erät.
 *  - Lähtevä maksu, jolle ML antoi riittävän varman ehdotuksen tilikartan tilistä
 *    => D Kulutili / K Pankki.
 *  - Muu lähtevä maksu => D Selvitettävät erät / K Pankki (täsmätään tositteeseen myöhemmin).
 */
export const resolveBankAccounts = (
  tx: BankTxLike,
  suggestion?: ExpenseSuggestion | null,
): { debitAccount: string; creditAccount: string } => {
  if (tx.creditDebit === 'CRDT') {
    return {
      debitAccount: ACCOUNTS.BANK,
      creditAccount: tx.referenceNumber ? ACCOUNTS.RECEIVABLES : ACCOUNTS.SUSPENSE,
    };
  }
  const useSuggestion =
    suggestion &&
    suggestion.accountExists &&
    suggestion.confidence >= ML_CONFIDENCE_THRESHOLD &&
    suggestion.account !== ACCOUNTS.BANK;
  return {
    debitAccount: useSuggestion ? suggestion.account : ACCOUNTS.SUSPENSE,
    creditAccount: ACCOUNTS.BANK,
  };
};
