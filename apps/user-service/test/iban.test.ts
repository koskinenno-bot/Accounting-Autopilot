import test from 'node:test';
import assert from 'node:assert/strict';
import { formatIban, isValidIban, normalizeIban } from '../src/iban';

test('kelvollinen suomalainen IBAN välilyönneillä ja pienillä kirjaimilla', () => {
  assert.equal(isValidIban('fi21 1234 5600 0007 85'), true);
  assert.equal(normalizeIban('fi21 1234 5600 0007 85'), 'FI2112345600000785');
  assert.equal(formatIban('FI2112345600000785'), 'FI21 1234 5600 0007 85');
});

test('väärä tarkiste, pituus tai muoto hylätään', () => {
  assert.equal(isValidIban('FI2112345600000786'), false);
  assert.equal(isValidIban('FI211234560000078'), false);
  assert.equal(isValidIban('FI1234567890123456'), false); // vanha malliarvo
  assert.equal(isValidIban(''), false);
  assert.equal(isValidIban(null), false);
});

test('muu maa', () => {
  assert.equal(isValidIban('DE89 3704 0044 0532 0130 00'), true);
});
