import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeVatReturn, ilmoitinFile, isBusinessId, parsePeriod, periodKeyFor, periodsOfYear, purchaseLines, salesRevenueLines, settlementLines,
} from '../src/vat';

const sum = (lines: { debit: number; credit: number }[]) => [
  Math.round(lines.reduce((s, l) => s + l.debit * 100, 0)), Math.round(lines.reduce((s, l) => s + l.credit * 100, 0)),
];
const iso = (d: Date) => d.toISOString().slice(0, 10);

test('verokaudet ja eräpäivät', () => {
  const m = parsePeriod('2026-11')!;
  assert.deepEqual([iso(m.start), iso(m.end), iso(m.due), m.label], ['2026-11-01', '2026-11-30', '2027-01-12', '11/2026']);
  const q = parsePeriod('2026-Q4')!;
  assert.deepEqual([iso(q.start), iso(q.end), iso(q.due), q.index], ['2026-10-01', '2026-12-31', '2027-02-12', 4]);
  const y = parsePeriod('2026')!;
  assert.deepEqual([iso(y.end), iso(y.due), y.index], ['2026-12-31', '2027-02-28', null]);
  assert.equal(iso(parsePeriod('2027')!.due), '2028-02-29', 'karkausvuosi');
  assert.equal(parsePeriod('2026-13'), null);
  assert.equal(periodKeyFor(new Date('2026-05-31T00:00:00Z'), 'QUARTER'), '2026-Q2');
  assert.equal(periodsOfYear(2026, 'MONTH').length, 12);
});

test('ostolasku: osittainen vähennysoikeus, vienti täsmää', () => {
  const lines = purchaseLines({ gross: 1255, vat: 255, deductionPercent: 60, expenseAccount: '4300', payableAccount: '2800', description: 'Huolto' });
  assert.deepEqual(lines.map((l) => [l.accountNumber, l.debit, l.credit, l.vatCode ?? null]), [
    ['4300', 1102, 0, 'P'], ['1750', 153, 0, null], ['2800', 0, 1255, null],
  ]);
  const [d, c] = sum(lines);
  assert.equal(d, c);
  const plain = purchaseLines({ gross: 100, vat: 0, deductionPercent: 100, expenseAccount: '4300', payableAccount: '2800', description: 'x' });
  assert.equal(plain.length, 2);
  assert.equal(purchaseLines({ gross: 100, vat: 25.5, deductionPercent: 0, expenseAccount: '4300', payableAccount: '2800', description: 'x' })
    .find((l) => l.accountNumber === '1750'), undefined, '0 % => ei saamista');
});

test('myynti: verollinen vuokra ja veroton vastike samalla laskulla', () => {
  const lines = salesRevenueLines([
    { accountNumber: '3100', gross: 1255, vatRate: 25.5, vatAmount: 255, description: 'Liiketilan vuokra' },
    { accountNumber: '3000', gross: 300, description: 'Hoitovastike' },
  ]);
  assert.deepEqual(lines.map((l) => [l.accountNumber, l.credit, l.vatCode ?? null, l.vatAmount ?? null]), [
    ['3100', 1000, 'S255', 255], ['3000', 300, null, null], ['2880', 255, null, null],
  ]);
});

test('kausiveroilmoitus vienneistä, hyvitys vähentää, tilitysvienti ei vaikuta', () => {
  const ledger = [
    ...salesRevenueLines([{ accountNumber: '3100', gross: 1255, vatRate: 25.5, vatAmount: 255 }]),
    // hyvityslasku 25,5 €
    { accountNumber: '3100', debit: 100, credit: 0, vatCode: 'S255', vatAmount: 25.5 },
    { accountNumber: '2880', debit: 25.5, credit: 0 },
    ...purchaseLines({ gross: 627.5, vat: 127.5, deductionPercent: 100, expenseAccount: '4300', payableAccount: '2800', description: 'x' }),
    { accountNumber: '3200', debit: 0, credit: 400, vatCode: 'S0' },
    // rakentamispalvelu, käännetty verovelvollisuus: vero 255 maksettavaksi ja vähennykseen
    { accountNumber: '4500', debit: 1000, credit: 0, vatCode: 'RCB', vatAmount: 255 },
    { accountNumber: '1750', debit: 255, credit: 0 },
    { accountNumber: '2880', debit: 0, credit: 255 },
    { accountNumber: '2800', debit: 0, credit: 1000 },
    { accountNumber: '2880', debit: 9999, credit: 0, entryType: 'VAT_SETTLEMENT' },
  ];
  const r = computeVatReturn(ledger);
  assert.equal(r.fields[301], 22950);
  assert.equal(r.fields[318], 25500);
  assert.equal(r.fields[320], 100000);
  assert.equal(r.fields[307], 12750 + 25500);
  assert.equal(r.fields[309], 40000);
  assert.equal(r.fields[308], 22950 + 25500 - 38250);
  assert.deepEqual(r.warnings, []);
  const s = settlementLines(r.fields, '11/2026');
  const [d, c] = sum(s);
  assert.equal(d, c);
  assert.deepEqual(s.map((l) => [l.accountNumber, l.debit, l.credit]), [['2880', 484.5, 0], ['1750', 0, 382.5], ['2885', 0, 102]]);
});

test('varoitus, kun vero on kirjattu ilman ALV-koodia', () => {
  const r = computeVatReturn([{ accountNumber: '3100', debit: 0, credit: 100 }, { accountNumber: '2880', debit: 0, credit: 25.5 }]);
  assert.equal(r.fields[301], 0);
  assert.match(r.warnings[0], /2880/);
});

test('palautettava vero kirjataan 2885 debetiin', () => {
  const r = computeVatReturn(purchaseLines({ gross: 125.5, vat: 25.5, deductionPercent: 100, expenseAccount: '4300', payableAccount: '2800', description: 'x' }));
  assert.equal(r.fields[308], -2550);
  assert.deepEqual(settlementLines(r.fields, 'Q1').map((l) => [l.accountNumber, l.debit, l.credit]), [['1750', 0, 25.5], ['2885', 25.5, 0]]);
});

test('Y-tunnuksen tarkiste', () => {
  assert.ok(isBusinessId('0737546-2'));
  assert.ok(isBusinessId('1572860-0'));
  assert.ok(!isBusinessId('0737546-3'));
  assert.ok(!isBusinessId('737546-2'));
});

test('Ilmoitin.fi-tiedosto VSRALVKV', () => {
  const r = computeVatReturn(salesRevenueLines([{ accountNumber: '3100', gross: 1255, vatRate: 25.5, vatAmount: 255 }]));
  const file = ilmoitinFile({
    fields: r.fields, period: parsePeriod('2026-Q4')!, businessId: '0737546-2', softwareId: '1572860-0_AK', softwareName: 'Taloluku',
    now: new Date(2026, 10, 15, 9, 5, 7),
  });
  const rows = file.trim().split('\r\n');
  assert.deepEqual(rows.slice(0, 8), ['000:VSRALVKV', '198:15112026090507', '014:1572860-0_AK', '048:Taloluku', '010:0737546-2', '050:Q', '052:4', '053:2026']);
  assert.ok(rows.includes('301:255,00'));
  assert.ok(rows.includes('308:255,00'));
  assert.equal(rows[rows.length - 1], '999:1');
  const empty = ilmoitinFile({ fields: computeVatReturn([]).fields, period: parsePeriod('2026')!, businessId: '0737546-2', softwareId: 'x', softwareName: 'y' });
  assert.ok(empty.includes('056:1') && !empty.includes('052:') && !empty.includes('301:'));
});

test('vastikelaskun kirjaus: verollinen rivi jaetaan, tuntematon tili hoitovastikkeisiin', async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { invoiceRevenueLines } = require('../src/consumers/invoiceConsumer');
  const exists = async (_c: string, a: string) => a !== '3999';
  const lines = await invoiceRevenueLines('c', 1555, [
    { accountNumber: '3100', amount: 1255, vatRate: 25.5, vatAmount: 255, description: 'Vuokra' },
    { accountNumber: '3999', amount: 300, description: 'Vastike' },
  ], exists);
  assert.deepEqual(lines.map((l: any) => [l.accountNumber, l.credit, l.vatCode]), [['3100', 1000, 'S255'], ['3000', 300, null], ['2880', 255, null]]);
  const plain = await invoiceRevenueLines('c', 300, [{ accountNumber: '3000', amount: 300 }], exists);
  assert.deepEqual(plain.map((l: any) => [l.accountNumber, l.credit, l.vatCode]), [['3000', 300, null]]);
});

test('veroilmoitus 4: rivit, tuloverot vähennyskelvottomia, tappio', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { form4 } = require('../src/taxReturn4');
  const r = form4({ '3000': 60000, '3100': 8000, '3550': 12000, '3900': 5000, '3950': 120, '4100': 30000, '5000': 20000, '6900': 25000, '8000': 9000, '9000': 500 });
  const row = (k: string) => r.rows.find((x: any) => x.key === k);
  assert.equal(row('vastikkeet').books, 65000);
  assert.equal(row('vuokrat').books, 20000);
  assert.equal(row('hoitokulut').books, 50000);
  assert.equal(row('tuloverot').books, 500);
  assert.equal(row('tuloverot').tax, 0);
  assert.equal(r.totals.booksResult, 85120 - 84500);
  assert.equal(r.totals.taxableIncome, 85120 - 84000);
  assert.equal(r.totals.confirmedLoss, 0);
  assert.match(r.warnings[0], /Pääomavastikkeet/);
  const loss = form4({ '3000': 1000, '4100': 1500 });
  assert.equal(loss.totals.confirmedLoss, 500);
  assert.equal(loss.totals.taxableIncome, 0);
});
