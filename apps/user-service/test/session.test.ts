import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../src/config';
import { LOCK_MINUTES, MAX_FAILED_LOGINS, afterFailedLogin, isLocked, signToken, tokenVersionValid } from '../src/session';

test('tunniste sisältää version, vanha versio hylätään', () => {
  const token = signToken({ id: 'u1', role: 'USER', tokenVersion: 3 });
  const decoded = jwt.verify(token, JWT_SECRET) as any;
  assert.equal(decoded.tv, 3);
  assert.equal(tokenVersionValid(decoded.tv, 3), true);
  assert.equal(tokenVersionValid(decoded.tv, 4), false);
  // Ennen versiointia annetut tunnisteet = versio 0
  assert.equal(tokenVersionValid(undefined, 0), true);
  assert.equal(tokenVersionValid(undefined, 1), false);
});

test('viides peräkkäinen virhe lukitsee tunnuksen 15 minuutiksi', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  let state = { failedLogins: 0, lockedUntil: null as Date | null };
  for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
    state = afterFailedLogin(state.failedLogins, now);
    assert.equal(state.failedLogins, i);
    assert.equal(state.lockedUntil, null);
  }
  state = afterFailedLogin(state.failedLogins, now);
  assert.ok(state.lockedUntil);
  assert.equal(state.lockedUntil!.getTime() - now.getTime(), LOCK_MINUTES * 60_000);
  assert.equal(isLocked(state.lockedUntil, now), true);
  assert.equal(isLocked(state.lockedUntil, new Date(now.getTime() + LOCK_MINUTES * 60_000 + 1)), false);
  assert.equal(isLocked(null, now), false);
});
