import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TATO_TEMPLATE, accountTypeFor } from '../src/services/chartOfAccountsService';
import { ACCOUNTS } from '../src/accounts';

test('tilinumeron alue määrää tilityypin', () => {
  assert.equal(accountTypeFor('1900'), 'ASSET');
  assert.equal(accountTypeFor('2000'), 'EQUITY');
  assert.equal(accountTypeFor('2399'), 'EQUITY');
  assert.equal(accountTypeFor('2500'), 'LIABILITY');
  assert.equal(accountTypeFor('3000'), 'REVENUE');
  assert.equal(accountTypeFor('39501'), 'REVENUE');
  assert.equal(accountTypeFor('4000'), 'EXPENSE');
  assert.equal(accountTypeFor('9000'), 'EXPENSE');
  for (const bad of ['0999', '123', 'abcd', '1234567', '', '12a4']) assert.equal(accountTypeFor(bad), null, bad);
});

test('tilikarttapohja on johdonmukainen', () => {
  const numbers = TATO_TEMPLATE.map((a) => a.number);
  assert.equal(new Set(numbers).size, numbers.length, 'tilinumerot ovat yksilöllisiä');
  for (const a of TATO_TEMPLATE) assert.equal(a.type, accountTypeFor(a.number), `${a.number} ${a.name}`);
  for (const n of Object.values(ACCOUNTS)) assert.ok(numbers.includes(n), `automaation tili ${n} puuttuu pohjasta`);
});

import { revenueLines } from '../src/consumers/invoiceConsumer';

test('vastikelaskun tulorivit tileittäin', async () => {
  const exists = async (_c: string, a: string) => a !== '3999';
  assert.deepEqual(await revenueLines('c', 100, undefined, exists), [{ accountNumber: '3000', cents: 10000, description: 'Hoitovastiketulo' }]);
  const r = await revenueLines('c', 357.17, [
    { accountNumber: '3000', amount: 234, description: 'Hoitovastike' },
    { accountNumber: '3900', amount: 64.17, description: 'Rahoitusvastike' },
    { accountNumber: '3999', amount: 59, description: 'Vesi' },
  ], exists);
  assert.deepEqual(r.map((l) => [l.accountNumber, l.cents]), [['3000', 29300], ['3900', 6417]]);
  assert.match(r[0].description, /tili 3999 puuttuu/);
  // Rivien summa ei täsmää laskuun => koko summa hoitovastikkeisiin
  assert.equal((await revenueLines('c', 100, [{ accountNumber: '3900', amount: 90 }], exists))[0].cents, 10000);
});
