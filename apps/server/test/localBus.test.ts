import test from 'node:test';
import assert from 'node:assert/strict';
import { publishLocal, subscribeLocal } from '../../../packages/config/events/localBus';

test('tilaajat saavat JSON-kopion järjestyksessä, sama nimi rekisteröityy kerran', async () => {
  const got: string[] = [];
  subscribeLocal('t1', 'a', (p) => { got.push(`a:${p.when}`); p.when = 'muutettu'; });
  subscribeLocal('t1', 'a', () => { got.push('kaksoiskappale'); });
  subscribeLocal('t1', 'b', (p) => { got.push(`b:${p.when}`); });
  await publishLocal('t1', { when: new Date('2026-01-02T00:00:00Z') });
  assert.deepEqual(got, ['a:2026-01-02T00:00:00.000Z', 'b:2026-01-02T00:00:00.000Z']);
});

test('ohimenevä virhe yritetään uudelleen, pysyvä näkyy julkaisijalle', async () => {
  let n = 0;
  subscribeLocal('t2', 'flaky', () => { if (++n < 2) throw new Error('hetkellinen'); });
  await publishLocal('t2', {});
  assert.equal(n, 2);
  subscribeLocal('t3', 'broken', () => { throw new Error('rikki'); });
  await assert.rejects(publishLocal('t3', {}), /broken: rikki/);
});
