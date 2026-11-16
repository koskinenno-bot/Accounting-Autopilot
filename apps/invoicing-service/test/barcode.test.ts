import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupReference, virtualBarcode } from '../src/barcode';

test('virtuaaliviivakoodi versio 4 (Finanssialan esimerkki)', () => {
  assert.equal(
    virtualBarcode('FI79 4405 2020 0360 82', 4883.15, '86851 62596 19897', new Date('2010-06-12')),
    '479440520200360820048831500000000868516259619897100612',
  );
});

test('virtuaaliviivakoodi: RF-viite, puuttuva eräpäivä ja virheelliset tiedot', () => {
  const rf = virtualBarcode('FI7944052020036082', 482.99, 'RF09 8685 1625 9619 897', new Date('2010-06-22'));
  assert.equal(rf, '579440520200360820004829909000000868516259619897100622');
  assert.match(virtualBarcode('FI7944052020036082', 10, '1232', null)!, /000000$/);
  assert.equal(virtualBarcode('SE4550000000058398257466', 10, '1232', null), null);
  assert.equal(virtualBarcode('FI7944052020036082', 10, 'ABC', null), null);
  assert.equal(virtualBarcode('FI7944052020036082', 10, '1232', null)!.length, 54);
});

test('viitteen ryhmittely', () => {
  assert.equal(groupReference('868516259619897'), '86851 62596 19897');
  assert.equal(groupReference('1232'), '1232');
});
