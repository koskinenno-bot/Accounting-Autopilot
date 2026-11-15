import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankBalancesAt, isIban, monthEnd, reconStatus } from '../src/bankRecon';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

test('IBAN-tarkiste', () => {
  assert.ok(isIban('FI21 1234 5600 0007 85'));
  assert.ok(!isIban('FI21 1234 5600 0007 86'));
  assert.ok(!isIban('123'));
});

test('kuun loppu ja tilikohtainen viimeisin saldo', () => {
  assert.equal(monthEnd(2026, 2).toISOString().slice(0, 10), '2026-02-28');
  const rows = [
    { iban: 'A', date: d('2026-10-31'), balance: 100, source: 'CAMT' },
    { iban: 'A', date: d('2026-11-30'), balance: 150.1, source: 'CAMT' },
    { iban: 'A', date: d('2026-12-02'), balance: 999, source: 'PSD2' },
    { iban: 'B', date: d('2026-11-20'), balance: 50.2, source: 'MANUAL' },
  ];
  const r = bankBalancesAt(rows, d('2026-11-30'));
  assert.equal(r.total, 200.3);
  assert.deepEqual(r.accounts.map((a) => [a.iban, a.balance, a.stale]), [['A', 150.1, false], ['B', 50.2, true]]);
  assert.equal(r.complete, false);
  assert.deepEqual(reconStatus(r, 200.3), { status: 'STALE', difference: 0 });
  const ok = bankBalancesAt(rows.slice(0, 2), d('2026-11-30'));
  assert.deepEqual(reconStatus(ok, 150.1), { status: 'OK', difference: 0 });
  assert.deepEqual(reconStatus(ok, 140), { status: 'DIFFERENCE', difference: 10.1 });
  assert.deepEqual(reconStatus(bankBalancesAt([], d('2026-11-30')), 5), { status: 'NO_BALANCE', difference: null });
});
