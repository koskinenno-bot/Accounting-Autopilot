import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessAutoApproval, isTrustedSupplier, matchPurchaseInvoice, normalizeReference, similarNames, supplierKey,
} from '../src/purchaseMatching';

const inv = (id: string, over: Partial<{ supplierName: string; totalAmount: number; dueDate: Date | null; referenceNumber: string | null; iban: string | null }> = {}) => ({
  id,
  supplierName: 'Helen Oy',
  totalAmount: 1452.36,
  dueDate: new Date('2026-10-14'),
  referenceNumber: '1111222223',
  iban: 'FI2112345600000785',
  ...over,
});

test('toimittaja-avain: Y-tunnus ensisijainen, muuten normalisoitu nimi', () => {
  assert.equal(supplierKey('Helen Oy', '2630226-0'), '2630226-0');
  assert.equal(supplierKey('Helen Oy', null), 'helen');
  assert.equal(supplierKey('HELEN OY', 'ei-tunnus'), 'helen');
  assert.ok(similarNames('HSY', 'HSY Jätehuolto'));
  assert.ok(!similarNames('Helen Oy', 'Fortum Oyj'));
});

test('viitteen vertailu ohittaa välilyönnit ja etunollat', () => {
  assert.equal(normalizeReference('00 11112 22223'), '1111222223');
  assert.equal(normalizeReference('rf18 5390 0754 7034'), 'RF18539007547034');
});

test('sääntö 1: viitenumero', () => {
  const open = [inv('a'), inv('b', { referenceNumber: '999' })];
  const m = matchPurchaseInvoice({ amount: 1452.36, bookingDate: '2026-10-14', referenceNumber: '11112 22223' }, open);
  assert.equal(m?.invoice.id, 'a');
  assert.equal(m?.rule, 1);
});

test('sääntö 2: summa + toimittaja eräpäivän lähellä', () => {
  const open = [inv('a', { referenceNumber: null }), inv('b', { supplierName: 'Fortum', referenceNumber: null })];
  const m = matchPurchaseInvoice({ amount: 1452.36, bookingDate: '2026-10-20', counterpartyName: 'HELEN OY' }, open);
  assert.deepEqual([m?.invoice.id, m?.rule], ['a', 2]);
  // liian kaukana eräpäivästä ja summa ei yksikäsitteinen => ei osumaa
  assert.equal(matchPurchaseInvoice({ amount: 1452.36, bookingDate: '2026-12-20', counterpartyName: 'Helen' }, open), null);
});

test('sääntö 3: summa yksikäsitteisesti', () => {
  const m = matchPurchaseInvoice({ amount: 1452.36, bookingDate: '2026-10-14', counterpartyName: 'Tuntematon' }, [inv('a', { referenceNumber: null })]);
  assert.deepEqual([m?.invoice.id, m?.rule], ['a', 3]);
  assert.equal(matchPurchaseInvoice({ amount: 10, bookingDate: '2026-10-14' }, [inv('a')]), null);
});

test('automaattihyväksyntä vain tekoälyn varmalla luvulla ja tunnistetulla tilillä', () => {
  const ok = { supplierName: 'Helen Oy', invoiceDate: '2026-09-30', dueDate: '2026-10-14', totalAmount: 10, confidence: 0.92, extractor: 'claude' };
  assert.equal(assessAutoApproval(ok, '4500').autoApprovable, true);
  assert.equal(assessAutoApproval({ ...ok, confidence: 0.7 }, '4500').autoApprovable, false);
  assert.equal(assessAutoApproval(ok, '1990').autoApprovable, false);
  assert.match(assessAutoApproval({ ...ok, extractor: 'heuristic' }, '4500').issues.join(), /ilman tekoälyä/);
});

test('tuttu toimittaja: sääntöpohjainen luku on varma vain samalla tilillä, tilinumerolla ja tavanomaisella summalla', () => {
  const prev = [
    { expenseAccount: '4500', iban: 'FI21 1234 5600 0007 85', totalAmount: 5000 },
    { expenseAccount: '4500', iban: 'FI2112345600000785', totalAmount: 4200 },
  ];
  assert.equal(isTrustedSupplier(prev, '4500', 'FI2112345600000785', 5200), true);
  assert.equal(isTrustedSupplier(prev.slice(0, 1), '4500', 'FI2112345600000785', 5200), false); // yksi lasku ei riitä
  assert.equal(isTrustedSupplier(prev, '4500', 'FI9999999999999999', 5200), false); // tilinumero vaihtui
  assert.equal(isTrustedSupplier(prev, '4600', 'FI2112345600000785', 5200), false); // eri kulutili
  assert.equal(isTrustedSupplier(prev, '4500', 'FI2112345600000785', 10001), false); // yli 2 x suurin aiempi
  assert.equal(isTrustedSupplier(prev, '4500', null, 100), false);
  const heuristic = { supplierName: 'Helen Oy', invoiceDate: '2025-01-03', dueDate: '2025-01-17', totalAmount: 10, confidence: 0.75, extractor: 'heuristic' };
  assert.equal(assessAutoApproval(heuristic, '4500').autoApprovable, false);
  assert.equal(assessAutoApproval(heuristic, '4500', { trustedSupplier: true }).autoApprovable, true);
  assert.equal(assessAutoApproval({ ...heuristic, dueDate: null }, '4500', { trustedSupplier: true }).autoApprovable, false);
});