import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canManage, canWrite, effectiveCompanyRole, validateAssignment, wouldRemoveLastOwner,
} from '../src/accessRules';

test('tehokas rooli: yhtiörooli, toimiston pääkäyttäjä ja ohitukset', () => {
  assert.equal(effectiveCompanyRole('USER', null, null), null);
  assert.equal(effectiveCompanyRole('USER', 'BOARD', null), 'BOARD');
  assert.equal(effectiveCompanyRole('USER', 'AUDITOR', 'MEMBER'), 'AUDITOR');
  // toimiston omistaja/pääkäyttäjä on isännöitsijä kaikissa toimiston yhtiöissä
  assert.equal(effectiveCompanyRole('USER', null, 'ADMIN'), 'MANAGER');
  assert.equal(effectiveCompanyRole('USER', 'BOARD', 'OWNER'), 'MANAGER');
  // pelkkä toimiston MEMBER ei näe yhtiötä ilman yhtiöroolia
  assert.equal(effectiveCompanyRole('USER', null, 'MEMBER'), null);
  assert.equal(effectiveCompanyRole('SUPER_ADMIN', null, null), 'MANAGER');
  assert.equal(effectiveCompanyRole('SERVICE', null, null), 'MANAGER');
  assert.equal(effectiveCompanyRole('USER', 'TUNTEMATON', null), null);
});

test('oikeudet: hallitus ja tarkastaja vain lukevat, assistentti ei sulje tilikautta', () => {
  assert.equal(canWrite('MANAGER'), true);
  assert.equal(canWrite('ASSISTANT'), true);
  assert.equal(canWrite('BOARD'), false);
  assert.equal(canWrite('AUDITOR'), false);
  assert.equal(canManage('MANAGER'), true);
  assert.equal(canManage('ASSISTANT'), false);
  assert.equal(canWrite(null), false);
});

test('kutsun ja oikeuksien syötteen tarkistus', () => {
  const ids = new Set(['a', 'b']);
  assert.equal(validateAssignment('MEMBER', [{ companyId: 'a', role: 'ASSISTANT' }], ids), null);
  assert.equal(validateAssignment(null, [{ companyId: 'a', role: 'BOARD' }], ids), null);
  assert.equal(validateAssignment('ADMIN', [], ids), null);
  assert.match(validateAssignment(null, [], ids)!, /vähintään yksi/);
  assert.match(validateAssignment(null, [{ companyId: 'x', role: 'BOARD' }], ids)!, /ei kuulu/);
  assert.match(validateAssignment(null, [{ companyId: 'a', role: 'ROOT' }], ids)!, /Tuntematon yhtiörooli/);
  assert.match(validateAssignment('BOSS', [], ids)!, /toimiston rooli/);
  assert.match(validateAssignment(null, [{ companyId: 'a', role: 'BOARD' }, { companyId: 'a', role: 'MANAGER' }], ids)!, /kahdesti/);
});

test('viimeistä omistajaa ei voi poistaa eikä alentaa', () => {
  assert.equal(wouldRemoveLastOwner(['u1'], 'u1', 'ADMIN'), true);
  assert.equal(wouldRemoveLastOwner(['u1'], 'u1', null), true);
  assert.equal(wouldRemoveLastOwner(['u1'], 'u1', 'OWNER'), false);
  assert.equal(wouldRemoveLastOwner(['u1', 'u2'], 'u1', null), false);
  assert.equal(wouldRemoveLastOwner(['u1'], 'u2', null), false);
});
