import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCents, validateLines } from '../src/validation';
import { resolveBankAccounts } from '../src/bankMapping';
import { ACCOUNTS } from '../src/accounts';

test('toCents välttää liukulukuvirheet ja hyväksyy pilkun', () => {
  assert.equal(toCents('0.1') + toCents('0.2'), toCents('0.3'));
  assert.equal(toCents('12,34'), 1234);
  assert.equal(toCents(undefined), 0);
  assert.ok(Number.isNaN(toCents('abc')));
});

test('tasapainoinen vienti hyväksytään', () => {
  assert.equal(validateLines([
    { accountNumber: '4500', debit: '0.10' },
    { accountNumber: '4600', debit: '0.20' },
    { accountNumber: '2800', credit: '0.30' },
  ]), null);
});

test('epätasapaino hylätään (KPL 2:2 §)', () => {
  assert.match(validateLines([
    { accountNumber: '4500', debit: 100 },
    { accountNumber: '2800', credit: 99.99 },
  ]) ?? '', /KPL 2:2/);
});

test('virheelliset rivit hylätään', () => {
  assert.ok(validateLines(undefined));
  assert.ok(validateLines([{ accountNumber: '1900', debit: 10 }]));
  assert.match(validateLines([{ accountNumber: '1900', debit: -5 }, { accountNumber: '3000', credit: -5 }]) ?? '', /negatiivisia/);
  assert.match(validateLines([{ accountNumber: '1900', debit: 5, credit: 5 }, { accountNumber: '3000', credit: 0 }]) ?? '', /joko debet tai kredit/);
  assert.match(validateLines([{ debit: 5 }, { accountNumber: '3000', credit: 5 }]) ?? '', /tilinumero/);
});

test('viitteellinen suoritus kirjataan myyntisaamisia vastaan, ei uudelleen tuotoksi', () => {
  assert.deepEqual(resolveBankAccounts({ creditDebit: 'CRDT', referenceNumber: '12345' }), {
    debitAccount: ACCOUNTS.BANK, creditAccount: ACCOUNTS.RECEIVABLES,
  });
  assert.deepEqual(resolveBankAccounts({ creditDebit: 'CRDT' }), {
    debitAccount: ACCOUNTS.BANK, creditAccount: ACCOUNTS.SUSPENSE,
  });
  assert.deepEqual(resolveBankAccounts({ creditDebit: 'DBIT' }), {
    debitAccount: ACCOUNTS.SUSPENSE, creditAccount: ACCOUNTS.BANK,
  });
});
