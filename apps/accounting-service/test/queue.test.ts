import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueue, closingDeadline, isSnoozed } from '../src/queue';

const today = new Date('2026-11-15T12:00:00Z');
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const empty = { today, drafts: [], missingVouchers: [], invoices: [], endedOpenYears: [], lastBankDates: [] };

test('tilinpäätöksen määräaika on 4 kk tilikauden päättymisestä', () => {
  assert.equal(closingDeadline(d('2025-12-31')).toISOString().slice(0, 10), '2026-04-30');
});

test('jono: kiireellisin ensin, varmat kirjaukset yhdeksi tehtäväksi', () => {
  const q = buildQueue({
    ...empty,
    drafts: [
      { id: 'e1', companyId: 'A', entryDate: d('2026-11-10'), description: 'Sähkö', counterparty: 'Helen', autoApprovable: false, needsVoucher: false, reviewNote: null, amount: 120 },
      { id: 'e2', companyId: 'A', entryDate: d('2026-11-11'), description: 'Vesi', counterparty: 'HSY', autoApprovable: true, needsVoucher: false, reviewNote: null, amount: 50 },
      { id: 'e3', companyId: 'A', entryDate: d('2026-11-12'), description: 'Siivous', counterparty: null, autoApprovable: true, needsVoucher: false, reviewNote: null, amount: 70 },
    ],
    invoices: [
      { id: 'i1', companyId: 'B', supplierName: 'Huolto Oy', invoiceNumber: '42', dueDate: d('2026-11-01'), totalAmount: 300, status: 'BOOKED' },
      { id: 'i2', companyId: 'B', supplierName: 'Kaukaa', invoiceNumber: null, dueDate: d('2026-12-30'), totalAmount: 10, status: 'BOOKED' },
      { id: 'i3', companyId: 'B', supplierName: 'Maksettu', invoiceNumber: null, dueDate: d('2026-11-01'), totalAmount: 10, status: 'PAID' },
    ],
    endedOpenYears: [{ id: 'fy', companyId: 'C', startDate: d('2025-01-01'), endDate: d('2025-12-31') }],
    lastBankDates: [{ companyId: 'A', lastDate: d('2026-11-14') }, { companyId: 'B', lastDate: null }],
  });
  assert.deepEqual(q.map((i) => i.key), ['closing:fy', 'invoice:i1', 'entry:e1', 'bank', 'auto']);
  const auto = q.find((i) => i.kind === 'AUTO')!;
  assert.equal(auto.count, 2);
  assert.equal(auto.amount, 120);
  assert.match(q[0].detail!, /ylittyi/);
});

test('jono: vanha puuttuva tosite nousee kiireellisemmäksi, tuore tiliote ei tuota tehtävää', () => {
  const q = buildQueue({
    ...empty,
    missingVouchers: [
      { id: 'v1', companyId: 'A', entryDate: d('2026-11-10'), description: 'Kortti', counterparty: null, amount: 20 },
      { id: 'v2', companyId: 'A', entryDate: d('2026-09-01'), description: 'Vanha', counterparty: null, amount: 20 },
    ],
    lastBankDates: [{ companyId: 'A', lastDate: d('2026-11-10') }],
  });
  assert.deepEqual(q.map((i) => [i.key, i.priority]), [['voucher:v2', 2], ['voucher:v1', 3]]);
});

test('torkutus', () => {
  assert.equal(isSnoozed(d('2026-11-20'), today), true);
  assert.equal(isSnoozed(d('2026-11-01'), today), false);
  assert.equal(isSnoozed(null, today), false);
});
