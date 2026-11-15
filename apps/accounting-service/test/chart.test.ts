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
