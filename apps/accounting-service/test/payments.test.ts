import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalState, buildPain001, findDuplicates, isValidIban, normalizeReference, paymentBlocker, sepaText } from '../src/payments';

const A = (role: string, decision: 'APPROVE' | 'REJECT' = 'APPROVE', userId = role) => ({ role, decision, userId });

test('hyväksyntä ilman hallituksen rajaa', () => {
  assert.equal(approvalState(100, null, []).status, 'PENDING');
  assert.equal(approvalState(100, null, []).waitingFor, 'isännöitsijä');
  assert.equal(approvalState(100, null, [A('MANAGER')]).status, 'APPROVED');
  assert.equal(approvalState(100, null, [A('BOARD')]).status, 'APPROVED');
});

test('rajan ylittävä lasku vaatii myös hallituksen', () => {
  assert.equal(approvalState(5000, 2000, [A('MANAGER')]).status, 'PENDING');
  assert.equal(approvalState(5000, 2000, [A('MANAGER')]).waitingFor, 'hallitus');
  assert.equal(approvalState(5000, 2000, []).waitingFor, 'isännöitsijä ja hallitus');
  assert.equal(approvalState(5000, 2000, [A('MANAGER'), A('BOARD')]).status, 'APPROVED');
  assert.equal(approvalState(2000, 2000, [A('MANAGER')]).status, 'APPROVED'); // raja mukaan lukien
  assert.equal(approvalState(5000, 2000, [A('MANAGER'), A('BOARD', 'REJECT')]).status, 'REJECTED');
});

test('IBAN ja viitteet', () => {
  assert.ok(isValidIban('FI21 1234 5600 0007 85'));
  assert.ok(!isValidIban('FI21 1234 5600 0007 86'));
  assert.ok(!isValidIban('FI2112345600000785XX'));
  assert.ok(isValidIban('DE89370400440532013000'));
  assert.equal(normalizeReference('12345 672'), '12345672');
  assert.equal(normalizeReference('00012345672'), '12345672');
  assert.equal(normalizeReference('12345673'), null);
  assert.equal(normalizeReference('RF18 5390 0754 7034'), 'RF18539007547034');
  assert.equal(normalizeReference('RF19 5390 0754 7034'), null);
  assert.equal(normalizeReference(''), null);
});

const inv = (o: any) => ({ id: 'a', supplierName: 'Huolto Oy', supplierKey: '1234567-8', invoiceNumber: '1', totalAmount: 100,
  dueDate: new Date('2026-12-01'), referenceNumber: '12345672', iban: 'FI2112345600000785', status: 'BOOKED',
  approvalStatus: 'APPROVED', paymentBatchId: null, ...o });

test('maksuun ottamisen esteet ja tuplalaskut', () => {
  assert.equal(paymentBlocker(inv({})), null);
  assert.equal(paymentBlocker(inv({ status: 'PAID' })), 'Lasku on jo maksettu');
  assert.equal(paymentBlocker(inv({ paymentBatchId: 'b' })), 'Lasku on jo maksuerässä');
  assert.equal(paymentBlocker(inv({ approvalStatus: 'PENDING' })), 'Laskua ei ole hyväksytty');
  assert.match(paymentBlocker(inv({ iban: 'FI00' }))!, /IBAN/);
  const d = findDuplicates([inv({ id: 'a' }), inv({ id: 'b', invoiceNumber: '2', dueDate: null }), inv({ id: 'c', totalAmount: 99 })]);
  assert.deepEqual([...d.entries()], [['a', 'b'], ['b', 'a']]);
});

test('pain.001-aineisto', () => {
  const xml = buildPain001({
    messageId: 'MSG1', createdAt: new Date('2026-11-15T10:00:00Z'), executionDate: '2026-11-20',
    debtorName: 'As Oy Kääpä & Co', debtorIban: 'FI21 1234 5600 0007 85', debtorBic: 'NDEAFIHH',
    payments: [
      { endToEndId: 'E1', amount: 100.1, creditorName: 'Huolto Oy', creditorIban: 'FI2112345600000785', reference: '12345672', message: '' },
      { endToEndId: 'E2', amount: 50, creditorName: 'Sähkö <Ab>', creditorIban: 'DE89370400440532013000', reference: null, message: 'Lasku 77 / lokakuu' },
    ],
  });
  assert.match(xml, /<NbOfTxs>2<\/NbOfTxs><CtrlSum>150.10<\/CtrlSum>/);
  assert.match(xml, /<Ref>12345672<\/Ref>/);
  assert.match(xml, /<Ustrd>Lasku 77 \/ lokakuu<\/Ustrd>/);
  assert.match(xml, /<Nm>As Oy Kaapa Co<\/Nm>/);
  assert.match(xml, /<Nm>Sahko Ab<\/Nm>/);
  assert.match(xml, /<BIC>NDEAFIHH<\/BIC>/);
  assert.match(xml, /<IBAN>FI2112345600000785<\/IBAN>/);
  assert.equal(sepaText('Öljy & Kaasu', 70), 'Oljy Kaasu');
});
