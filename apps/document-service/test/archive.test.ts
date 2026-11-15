import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closingArchiveItems, looksLikePdf, retentionUntil } from '../src/archive';

test('säilytys 10 vuotta tilikauden päättymisestä', () => {
  assert.equal(retentionUntil(new Date('2026-12-31T00:00:00Z')).toISOString().slice(0, 10), '2036-12-31');
  assert.equal(retentionUntil(new Date('2026-06-30T00:00:00Z')).toISOString().slice(0, 10), '2036-12-31');
});

test('arkistoon tilinpäätös, tase-erittelyt, päiväkirja ja pääkirja', () => {
  const items = closingArchiveItems('fy1', '2026');
  assert.deepEqual(items.map((i) => i.name), ['Tilinpäätös 2026', 'Tase-erittelyt 2026', 'Päiväkirja 2026', 'Pääkirja 2026']);
  assert.equal(new Set(items.map((i) => i.key)).size, 4);
  assert.ok(items.every((i) => i.key.startsWith('closing:fy1:')));
});

test('PDF tunnistetaan', () => {
  assert.equal(looksLikePdf(Buffer.from('%PDF-1.7 ...')), true);
  assert.equal(looksLikePdf(Buffer.from('{"error":"x"}')), false);
});
