import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  balancesFromLines, buildCarryForwardLines, buildClosingLines, buildOpeningLines, depreciationFor,
} from '../src/closing';

test('avaustase: vastaavaa debetiin, vastattavaa kreditiin, oltava tasapainossa', () => {
  const lines = buildOpeningLines([
    { accountNumber: '1010', balance: 500000 },
    { accountNumber: '1900', balance: 30000 },
    { accountNumber: '2000', balance: 100000 },
    { accountNumber: '2100', balance: 30000 },
    { accountNumber: '2500', balance: 400000 },
  ]);
  assert.deepEqual(lines.map((l) => [l.accountNumber, l.debit, l.credit]), [
    ['1010', 500000, 0], ['1900', 30000, 0], ['2000', 0, 100000], ['2100', 0, 30000], ['2500', 0, 400000],
  ]);
  // negatiivinen saldo (esim. kertynyt tappio) kääntää puolen
  const loss = buildOpeningLines([{ accountNumber: '1900', balance: 1000 }, { accountNumber: '2000', balance: 1500 }, { accountNumber: '2100', balance: -500 }]);
  assert.deepEqual(loss.find((l) => l.accountNumber === '2100'), { accountNumber: '2100', debit: 500, credit: 0, description: 'Avaussaldo' });
  assert.throws(() => buildOpeningLines([{ accountNumber: '1900', balance: 100 }, { accountNumber: '2000', balance: 99 }]), /ei täsmää/);
  assert.throws(() => buildOpeningLines([{ accountNumber: '4000', balance: 100 }]), /ei ole tasetili/);
});

test('poistot: menojäännös, tasapoisto ja käsin, ei yli kirjanpitoarvon', () => {
  assert.equal(depreciationFor({ method: 'DECLINING', acquisitionCost: 500000, rate: 4 }, 450000), 18000);
  assert.equal(depreciationFor({ method: 'STRAIGHT_LINE', acquisitionCost: 100000, usefulLifeYears: 30 }, 50000), 3333.33);
  assert.equal(depreciationFor({ method: 'MANUAL', acquisitionCost: 0, manualAmount: 24000 }, 10000), 10000);
});

test('tilinpäätösvienti nollaa tulostilit ja kirjaa tuloksen tilille 2200', () => {
  const balances = balancesFromLines([
    { accountNumber: '3000', debit: 0, credit: 1593 },
    { accountNumber: '4500', debit: 1452.36, credit: 0 },
    { accountNumber: '1900', debit: 140.64, credit: 0 },
  ]);
  const { lines, result } = buildClosingLines(balances);
  assert.equal(result, 140.64);
  const sum = (k: 'debit' | 'credit') => Math.round(lines.reduce((s, l) => s + l[k] * 100, 0));
  assert.equal(sum('debit'), sum('credit'));
  assert.deepEqual(lines.find((l) => l.accountNumber === '2200'), { accountNumber: '2200', debit: 0, credit: 140.64, description: 'Tilikauden voitto' });
  assert.ok(!lines.some((l) => l.accountNumber === '1900'));
});

test('seuraavan kauden avaus: tasetilit siirtyvät, 2200 yhdistetään tilille 2100', () => {
  const lines = buildCarryForwardLines(balancesFromLines([
    { accountNumber: '1900', debit: 27000, credit: 0 },
    { accountNumber: '2100', debit: 0, credit: 30000 },
    { accountNumber: '2200', debit: 3000, credit: 0 },  // tappio
    { accountNumber: '4500', debit: 3000, credit: 0 },  // tulostili ei siirry
  ]));
  assert.deepEqual(lines.map((l) => [l.accountNumber, l.debit, l.credit]), [['1900', 27000, 0], ['2100', 0, 27000]]);
});
