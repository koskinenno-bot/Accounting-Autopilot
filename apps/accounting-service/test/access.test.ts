import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelForMethod, roleAllows } from '../src/middleware/requireAuth';

test('käyttöoikeustasot: lukevat metodit = read, muut = write', () => {
  assert.equal(levelForMethod('GET'), 'read');
  assert.equal(levelForMethod('head'), 'read');
  assert.equal(levelForMethod('POST'), 'write');
  assert.equal(levelForMethod('PATCH'), 'write');
  assert.equal(levelForMethod('DELETE'), 'write');
});

test('roolit: hallitus ja tarkastaja lukevat, assistentti kirjaa, vain isännöitsijä sulkee tilikauden', () => {
  for (const r of ['MANAGER', 'ASSISTANT', 'BOARD', 'AUDITOR']) assert.equal(roleAllows(r, 'read'), true);
  assert.equal(roleAllows('BOARD', 'write'), false);
  assert.equal(roleAllows('AUDITOR', 'write'), false);
  assert.equal(roleAllows('ASSISTANT', 'write'), true);
  assert.equal(roleAllows('ASSISTANT', 'manage'), false);
  assert.equal(roleAllows('MANAGER', 'manage'), true);
  assert.equal(roleAllows(null, 'read'), false);
});
