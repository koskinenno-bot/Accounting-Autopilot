import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageSignature, signatureKey } from '../src/services/learningService';

test('viestin tunniste erottaa saman saajan eri maksut ja ohittaa numerot ja kuukaudet', () => {
  assert.equal(messageSignature('Lainan 7788 lyhennys 03/2025'), 'lainan lyhennys');
  assert.equal(messageSignature('Lainan 7788 korko 04/2025'), 'lainan korko');
  assert.equal(messageSignature('Pankkitapahtuma: Rahoituspankki Oyj / Lainan 7788 korko 04/2025', 'Rahoituspankki Oyj'), 'lainan korko');
  assert.equal(messageSignature('Palvelumaksu marraskuu 2025'), 'palvelumaksu');
  assert.equal(messageSignature(''), '');
  assert.equal(signatureKey('rahoituspankki', ''), '');
  assert.equal(signatureKey('rahoituspankki', 'lainan korko'), 'rahoituspankki|lainan korko');
});
