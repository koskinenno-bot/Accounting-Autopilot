import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashToken, isValidTokenFormat, maskEmail, newResetToken, passwordProblem, resetStatus } from '../src/passwordReset';

test('tunniste: satunnainen, kantaan vain tiiviste', () => {
  const a = newResetToken();
  const b = newResetToken();
  assert.notEqual(a.token, b.token);
  assert.ok(isValidTokenFormat(a.token));
  assert.equal(a.tokenHash, hashToken(a.token));
  assert.notEqual(a.tokenHash, a.token);
  assert.equal(isValidTokenFormat('../../etc'), false);
  assert.equal(isValidTokenFormat(undefined), false);
});

test('salasanan vaatimukset', () => {
  assert.match(passwordProblem('lyhyt')!, /vähintään 8/);
  assert.match(passwordProblem('aaaaaaaaaa')!, /samaa merkkiä/);
  assert.match(passwordProblem('Aino@Esim.fi', 'aino@esim.fi')!, /sähköpostiosoite/);
  assert.equal(passwordProblem('kunnollinen-salasana', 'aino@esim.fi'), null);
  assert.ok(passwordProblem(12345678 as any));
});

test('linkin tila ja osoitteen peitto', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  assert.equal(resetStatus(null, now), 'unknown');
  assert.equal(resetStatus({ expiresAt: new Date('2026-11-15T13:00:00Z'), usedAt: null }, now), 'valid');
  assert.equal(resetStatus({ expiresAt: new Date('2026-11-15T11:59:59Z'), usedAt: null }, now), 'expired');
  assert.equal(resetStatus({ expiresAt: new Date('2026-11-15T13:00:00Z'), usedAt: now }, now), 'used');
  assert.equal(maskEmail('isannoitsija@toimisto.fi'), 'i***********@toimisto.fi');
  assert.equal(maskEmail('a@b.fi'), 'a**@b.fi');
});
