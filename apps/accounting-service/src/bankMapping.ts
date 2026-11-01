import { ACCOUNTS } from './accounts';

export interface BankTxLike {
  creditDebit: 'CRDT' | 'DBIT';
  referenceNumber?: string;
}

/**
 * Pankkitapahtuman tiliöinti:
 *  - Saapuva maksu viitteellä => D Pankki / K Myyntisaamiset
 *    (vastikelasku on jo kirjattu D Myyntisaamiset / K Hoitovastikkeet,
 *    joten tulon kirjaaminen uudestaan kahdentaisi vastiketuotot).
 *  - Saapuva maksu ilman viitettä => D Pankki / K Selvitettävät erät.
 *  - Lähtevä maksu => D Selvitettävät erät / K Pankki (täsmätään tositteeseen myöhemmin).
 */
export const resolveBankAccounts = (tx: BankTxLike): { debitAccount: string; creditAccount: string } => {
  if (tx.creditDebit === 'CRDT') {
    return {
      debitAccount: ACCOUNTS.BANK,
      creditAccount: tx.referenceNumber ? ACCOUNTS.RECEIVABLES : ACCOUNTS.SUSPENSE,
    };
  }
  return { debitAccount: ACCOUNTS.SUSPENSE, creditAccount: ACCOUNTS.BANK };
};
