import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REQUEST_ROWS, buildVoucherRequest } from '../src/voucherRequests';
import { buildQueue } from '../src/queue';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

test('tositepyyntö listaa maksut vanhimmasta alkaen', () => {
  const mail = buildVoucherRequest('As Oy Demokoti', [
    { id: 'b', entryDate: d('2026-11-03'), amount: 89.9, counterparty: 'K-Rauta', description: null },
    { id: 'a', entryDate: d('2026-10-12'), amount: 1250, counterparty: null, description: 'Kortti 1234' },
  ], 'Muistathan myös lumityöt.');
  assert.equal(mail.subject, 'Puuttuvat tositteet: As Oy Demokoti (2 kpl)');
  assert.deepEqual(mail.ids, ['a', 'b']);
  const iA = mail.body.indexOf('12.10.2026'); const iB = mail.body.indexOf('3.11.2026');
  assert.ok(iA > 0 && iB > iA);
  assert.match(mail.body, /K-Rauta/);
  assert.match(mail.body, /Kortti 1234/);
  assert.match(mail.body, /Muistathan myös lumityöt/);
});

test('tositepyynnössä on enintään 50 riviä', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: String(i), entryDate: d('2026-10-01'), amount: 1, counterparty: 'X', description: null }));
  const mail = buildVoucherRequest('Yhtiö', many);
  assert.equal(mail.count, MAX_REQUEST_ROWS);
  assert.match(mail.body, /ja 10 muuta/);
});

test('äskettäin pyydetty tosite ei ole jonossa kiireellinen', () => {
  const base = { companyId: 'c', description: null, counterparty: 'Toimittaja', amount: 10, entryDate: d('2026-09-01') };
  const items = buildQueue({
    today: d('2026-11-15'), drafts: [], invoices: [], endedOpenYears: [], lastBankDates: [],
    missingVouchers: [
      { ...base, id: 'old' },
      { ...base, id: 'asked', voucherRequestedAt: d('2026-11-12'), voucherRequestedFrom: 'pj@example.fi' },
    ],
  });
  const old = items.find((i) => i.key === 'voucher:old')!;
  const asked = items.find((i) => i.key === 'voucher:asked')!;
  assert.equal(old.priority, 2);
  assert.equal(asked.priority, 3);
  assert.match(asked.detail!, /pyydetty 12\.11\.2026 \(pj@example\.fi\)/);
});
