import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFees, countShares, loanShareOf, isPeriod } from '../src/fees';
import type { ApartmentInput, FeeComponentInput } from '../src/fees';
import { apartmentBalances, daysOverdue, lateInterest, openAmount, reminderCandidates, statusAfterPayment } from '../src/reskontra';

const comps: FeeComponentInput[] = [
  { id: 'h', name: 'Hoitovastike', basis: 'SQM', unitPrice: 4.5, accountNumber: '3000', loanCapital: false, isActive: true },
  { id: 'r', name: 'Rahoitusvastike', basis: 'SHARES', unitPrice: 0.1234, accountNumber: '3900', loanCapital: true, isActive: true },
  { id: 'v', name: 'Vesimaksu', basis: 'PERSONS', unitPrice: 22, accountNumber: '3100', loanCapital: false, isActive: true },
  { id: 'a', name: 'Autopaikka', basis: 'PARKING', unitPrice: 15, accountNumber: '3200', loanCapital: false, isActive: true },
  { id: 'x', name: 'Poistettu', basis: 'FIXED', unitPrice: 99, accountNumber: '3600', loanCapital: false, isActive: false },
];
const apt = (apartment: string, sqm: number, shares: number, persons = 0, parking = 0): ApartmentInput => ({
  apartment, owners: [{ shareholderId: `s-${apartment}`, name: `Omistaja ${apartment}`, email: `${apartment}@x.fi` }],
  squareMeters: sqm, shares, persons, parkingSpots: parking,
});

test('osakkeiden määrä merkinnöistä', () => {
  assert.equal(countShares(['1-350']), 350);
  assert.equal(countShares(['1-10', '20', '30–31']), 13);
  assert.equal(countShares(['1-5, 7-8']), 7);
  assert.equal(countShares(['abc', '10-5', null as any]), 0);
  assert.equal(countShares(undefined), 0);
});

test('vastikkeet huoneistoittain perusteiden mukaan', () => {
  const fees = calculateFees(comps, [apt('A 2', 52, 520, 2, 1), apt('A 10', 35, 350, 1), apt('B 1', 0, 0)]);
  assert.deepEqual(fees.map((f) => f.apartment), ['A 2', 'A 10']); // numeerinen järjestys, tyhjä huoneisto pois
  const a2 = fees[0];
  assert.deepEqual(a2.lines.map((l) => [l.description, l.amount, l.accountNumber]), [
    ['Hoitovastike', 234, '3000'], ['Rahoitusvastike', 64.17, '3900'], ['Vesimaksu', 44, '3100'], ['Autopaikka', 15, '3200'],
  ]);
  assert.equal(a2.total, 357.17);
  assert.equal(a2.recipientEmail, 'A 2@x.fi');
});

test('lainaosuuden pois maksanut huoneisto ei maksa rahoitusvastiketta', () => {
  const fees = calculateFees(comps, [apt('A 1', 50, 500)], new Map([['A 1', new Set(['r'])]]));
  assert.deepEqual(fees[0].lines.map((l) => l.description), ['Hoitovastike']);
  assert.deepEqual(fees[0].exempted, ['Rahoitusvastike']);
});

test('lainaosuus osakkeiden suhteessa', () => {
  assert.equal(loanShareOf(1_000_000, 350, 3540), 98870.06);
  assert.equal(loanShareOf(1000, 1, 0), 0);
  assert.ok(isPeriod('2026-11') && !isPeriod('2026-13') && !isPeriod('11/2026'));
});

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const inv = (o: Partial<any>) => ({
  id: 'i', apartment: 'A 1', recipientName: 'Aino', kind: 'FEE', status: 'SENT', issueDate: d('2026-10-01'),
  dueDate: d('2026-10-05'), totalAmount: 100, paidAmount: 0, lastReminderAt: null, ...o,
});

test('avoin määrä, myöhästymispäivät ja viivästyskorko', () => {
  assert.equal(openAmount(inv({ paidAmount: 40.1 })), 59.9);
  assert.equal(openAmount(inv({ status: 'CANCELLED' })), 0);
  assert.equal(daysOverdue(d('2026-10-05'), d('2026-10-05')), 0);
  assert.equal(daysOverdue(d('2026-10-05'), new Date('2026-11-04T23:00:00Z')), 30);
  // 1000 € * 9 % * 30/365 = 7,40 €
  assert.equal(lateInterest(1000, d('2026-10-05'), d('2026-11-04'), 2), 7.4);
  assert.equal(lateInterest(1000, d('2026-10-05'), d('2026-10-01'), 2), 0);
});

test('muistutettavat: aikaraja, maksuaika ja muistutuskulujen katto', () => {
  const s = { referenceRate: 2, reminderFee: 10, reminderDaysAfterDue: 14, paymentTermDays: 14 };
  const today = d('2026-11-15');
  const list = reminderCandidates([
    inv({ id: 'old', dueDate: d('2026-10-05') }),
    inv({ id: 'new', dueDate: d('2026-11-05') }),
    inv({ id: 'reminded', dueDate: d('2026-09-05'), lastReminderAt: d('2026-11-10') }),
    inv({ id: 'paid', dueDate: d('2026-09-05'), paidAmount: 100 }),
    inv({ id: 'rem', kind: 'REMINDER', dueDate: d('2026-09-05') }),
  ], today, s);
  assert.deepEqual(list.map((c) => [c.invoiceId, c.eligible]), [['reminded', false], ['old', true], ['new', false]]);
  assert.equal(list[1].fee, 5); // kuluttajalta enintään 5 €
  assert.ok(list[1].interest > 0);
});

test('huoneistokohtaiset saldot', () => {
  const rows = apartmentBalances([
    inv({ id: '1', totalAmount: 100, paidAmount: 100, status: 'PAID' }),
    inv({ id: '2', totalAmount: 100, paidAmount: 30, dueDate: d('2026-11-05'), issueDate: d('2026-11-01'), recipientName: 'Uusi omistaja' }),
    inv({ id: '3', apartment: 'B 2', totalAmount: 50 }),
    inv({ id: '4', apartment: 'B 2', totalAmount: 50, status: 'CANCELLED' }),
  ], d('2026-11-15'));
  assert.deepEqual(rows.map((r) => [r.apartment, r.billed, r.paid, r.open, r.overdue, r.recipientName]), [
    ['A 1', 200, 130, 70, 70, 'Uusi omistaja'], ['B 2', 50, 0, 50, 50, 'Aino'],
  ]);
});

test('tila maksun jälkeen', () => {
  assert.equal(statusAfterPayment(100, 100, 'SENT'), 'PAID');
  assert.equal(statusAfterPayment(100, 40, 'OVERDUE'), 'OVERDUE');
  assert.equal(statusAfterPayment(100, 40, 'PAID'), 'SENT');
});
