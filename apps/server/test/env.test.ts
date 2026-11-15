import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEnv } from '../src/env';

const files = {
  'user-service': { PORT: '3001', DATABASE_URL: 'postgresql://u', JWT_SECRET: 'a', SERVICE_TOKEN: 's', SMTP_HOST: 'smtp.x' },
  'accounting-service': { PORT: '3002', DATABASE_URL: 'postgresql://acc', JWT_SECRET: 'a', ML_SERVICE_URL: 'http://muu' },
  'bank-service': { DATABASE_URL: 'postgresql://bank', JWT_SECRET: 'eri' },
  'ml-service': { ANTHROPIC_API_KEY: 'k', JWT_SECRET: 'x' },
};

test('palveluiden kannat omiin muuttujiinsa, PORT ja DATABASE_URL eivät vuoda', () => {
  const { env } = buildEnv({}, {}, files, 3000, '/r');
  assert.equal(env.USER_DATABASE_URL, 'postgresql://u');
  assert.equal(env.ACCOUNTING_DATABASE_URL, 'postgresql://acc');
  assert.equal(env.BANK_DATABASE_URL, 'postgresql://bank');
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.PORT, undefined);
  assert.equal(env.SMTP_HOST, 'smtp.x');
  assert.equal(env.ANTHROPIC_API_KEY, 'k');
});

test('palvelut kutsuvat samaa porttia, väylä paikallinen, tositteet levylle', () => {
  const { env } = buildEnv({}, {}, files, 3000, '/r');
  assert.equal(env.USER_SERVICE_URL, 'http://127.0.0.1:3000/api/v1');
  assert.equal(env.AUDIT_SERVICE_URL, 'http://127.0.0.1:3000/api/v1');
  assert.equal(env.ML_SERVICE_URL, 'http://127.0.0.1:8001/api/v1'); // palvelun .env:n URL ei kelpaa
  assert.equal(env.EVENT_BUS, 'local');
  assert.equal(env.VOUCHER_STORAGE, 'local');
});

test('eri JWT_SECRET varoittaa ja ensimmäinen arvo pysyy', () => {
  const { env, warnings } = buildEnv({}, {}, files, 3000, '/r');
  assert.equal(env.JWT_SECRET, 'a');
  assert.ok(warnings.some((w) => w.includes('bank-service') && w.includes('JWT_SECRET')));
});

test('komentorivi ja palvelimen .env voittavat palveluiden tiedostot', () => {
  const { env } = buildEnv({ JWT_SECRET: 'cli', EVENT_BUS: 'kafka' }, { USER_DATABASE_URL: 'postgresql://server', MINIO_ENDPOINT: 'http://m' }, files, 3000, '/r');
  assert.equal(env.JWT_SECRET, 'cli');
  assert.equal(env.EVENT_BUS, 'kafka');
  assert.equal(env.USER_DATABASE_URL, 'postgresql://server');
  assert.equal(env.VOUCHER_STORAGE, 's3');
});

test('puuttuvat kannat ja salaisuudet näkyvät varoituksina', () => {
  const { warnings } = buildEnv({}, {}, {}, 3000, '/r');
  assert.ok(warnings.some((w) => w.startsWith('USER_DATABASE_URL puuttuu')));
  assert.ok(warnings.includes('JWT_SECRET puuttuu'));
});
