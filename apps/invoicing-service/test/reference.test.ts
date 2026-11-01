import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFinnishReference, formatReference } from '../src/services/referenceService';

test('viitenumeron tarkiste 7-3-1', () => {
  // Tunnetut esimerkit: 1234561, 1009 (100 + 9), 123453
  assert.equal(calculateFinnishReference('123456'), '1234561');
  assert.equal(calculateFinnishReference('100'), '1009');
  assert.equal(calculateFinnishReference('12345'), '123453');
});

test('viitenumeron ryhmittely viiden merkin ryhmiin', () => {
  assert.equal(formatReference('1234567890123'), '12345 67890 123');
});
