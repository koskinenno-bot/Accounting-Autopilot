import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTimestamp, recordHash, stableStringify, verifyChain } from '../src/chain';

const base = (i: number) => ({
  id: `id-${i}`, companyId: 'c1', userId: 'u1', action: 'UPDATE', entityType: 'JOURNAL_ENTRY', entityId: `e${i}`,
  description: `Vienti ${i}`, changes: { after: { amount: i * 10, account: '4000' }, before: null }, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
});
const chain = (n: number) => {
  const rows: any[] = [];
  let prev: string | null = null;
  for (let i = 1; i <= n; i++) {
    const f = base(i);
    const hash = recordHash(prev, f);
    rows.push({ ...f, prevHash: prev, hash });
    prev = hash;
  }
  return rows;
};

test('avainten järjestys ei vaikuta (jsonb)', () => {
  assert.equal(stableStringify({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), '{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}');
  const f = base(1);
  assert.equal(recordHash(null, f), recordHash(null, { ...f, changes: { before: null, after: { account: '4000', amount: 10 } } }));
});

test('ehjä ketju ja vanhat rivit ennen ketjutusta', () => {
  const legacy = { ...base(0), prevHash: null, hash: null };
  assert.deepEqual(verifyChain([legacy, ...chain(4)]), { ok: true, checked: 4, legacy: 1, brokenAt: null, reason: null });
});

test('muutettu, poistettu tai väliin lisätty rivi havaitaan', () => {
  const edited = chain(4);
  edited[2] = { ...edited[2], description: 'Muutettu jälkikäteen' };
  assert.equal(verifyChain(edited).brokenAt, 'id-3');
  assert.match(verifyChain(edited).reason!, /sisältöä/);

  const deleted = chain(4);
  deleted.splice(1, 1);
  assert.equal(verifyChain(deleted).brokenAt, 'id-3');

  const inserted = chain(3);
  inserted.splice(2, 0, { ...base(9), prevHash: null, hash: null });
  assert.equal(verifyChain(inserted).ok, false);
});

test('aikaleima aina edellistä myöhäisempi', () => {
  const t = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(nextTimestamp(t, t).toISOString(), '2026-01-01T00:00:00.001Z');
  assert.equal(nextTimestamp(null, t), t);
  assert.equal(nextTimestamp(t, new Date('2026-01-02T00:00:00Z')).toISOString(), '2026-01-02T00:00:00.000Z');
});
