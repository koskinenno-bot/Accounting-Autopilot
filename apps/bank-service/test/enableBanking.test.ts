import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  consentValidUntil, fetchAllTransactions, loadConfig, makeJwt, mapTransaction, normalizeReference, pickBalance, syncDateFrom,
} from '../src/services/enableBanking';
import { syncAccount } from '../src/services/bankSync';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const APP_ID = '0b0f6c3e-1111-4a2b-9c3d-123456789abc';

test('JWT: RS256, kid = sovellustunnus, iss/aud kiinteät, tunnin voimassaolo', () => {
  const jwt = makeJwt(APP_ID, privateKey, 1_700_000_000);
  const [h, b, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { typ: 'JWT', alg: 'RS256', kid: APP_ID });
  assert.deepEqual(JSON.parse(Buffer.from(b, 'base64url').toString()),
    { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: 1_700_000_000, exp: 1_700_003_600 });
  assert.ok(!/[=+/]/.test(jwt), 'base64url ilman täytettä');
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, Buffer.from(s, 'base64url')));
});

test('asetukset: .pem salaiset-kansiosta, tunnus tiedoston nimestä', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-'));
  assert.equal(loadConfig({}, dir), null, 'ei avainta => ei käytössä');
  fs.writeFileSync(path.join(dir, 'avain.pem'), privateKey);
  assert.equal(loadConfig({}, dir), null, 'nimi ei ole sovellustunnus');
  fs.renameSync(path.join(dir, 'avain.pem'), path.join(dir, `${APP_ID}.pem`));
  const c = loadConfig({}, dir)!;
  assert.equal(c.appId, APP_ID);
  assert.equal(c.apiUrl, 'https://api.enablebanking.com');
  assert.equal(c.redirectUrl, 'http://localhost:5173/bank-connections/callback');
  assert.ok(c.privateKey.includes('PRIVATE KEY'));
});

test('tapahtuman muunnos: saapuva viitesuoritus RF-viitteellä', () => {
  const tx = mapTransaction({
    entry_reference: '20261101123456789', transaction_amount: { amount: '245.50', currency: 'EUR' },
    credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-11-01',
    debtor: { name: 'Virtanen Matti' }, debtor_account: { iban: 'FI21 1234 5600 0007 85' },
    reference_number: 'RF18 1234 5', remittance_information: ['Vastike marraskuu'],
  }, 'acc-1')!;
  assert.deepEqual(tx, {
    bookingDate: '2026-11-01', amount: 245.5, currency: 'EUR', creditDebit: 'CRDT', referenceNumber: '12345',
    counterpartyName: 'Virtanen Matti', payerName: 'Virtanen Matti', payerIban: 'FI2112345600000785',
    remittanceInfo: 'Vastike marraskuu', entryReference: '20261101123456789',
  });
});

test('tapahtuman muunnos: lähtevä maksu, varaukset ohitetaan, tunniste pysyy samana', () => {
  const raw = {
    transaction_amount: { amount: '-89.90', currency: 'EUR' }, status: 'BOOK', booking_date: '2026-11-03',
    creditor: { name: 'Helen Oy' }, remittance_information: ['Lasku 4455'],
  };
  const a = mapTransaction(raw, 'acc-1')!;
  assert.equal(a.creditDebit, 'DBIT');
  assert.equal(a.amount, 89.9);
  assert.equal(a.counterpartyName, 'Helen Oy');
  assert.match(a.entryReference!, /^EB[0-9a-f]{24}$/);
  assert.equal(mapTransaction(raw, 'acc-1')!.entryReference, a.entryReference, 'deterministinen');
  assert.notEqual(mapTransaction(raw, 'acc-2')!.entryReference, a.entryReference, 'tilikohtainen');
  assert.equal(mapTransaction({ ...raw, status: 'PDNG' }, 'acc-1'), null);
  assert.equal(mapTransaction({ ...raw, transaction_amount: { amount: '0' } }, 'acc-1'), null);
});

test('viite viestistä vain, jos viesti on pelkkä viite', () => {
  const base = { transaction_amount: { amount: '10' }, credit_debit_indicator: 'CRDT', booking_date: '2026-11-01' };
  assert.equal(mapTransaction({ ...base, remittance_information: ['1234 5'] }, 'a')!.referenceNumber, '12345');
  assert.equal(mapTransaction({ ...base, remittance_information: ['Vuokra 11/2026'] }, 'a')!.referenceNumber, undefined);
  assert.equal(normalizeReference('rf18 12345'), '12345');
  assert.equal(normalizeReference('00012345'), '00012345');
});

test('saldo: kirjattu päätössaldo ensin', () => {
  assert.equal(pickBalance([
    { balance_type: 'CLAV', balance_amount: { amount: '900.00' } },
    { balance_type: 'CLBD', balance_amount: { amount: '1000.00' } },
  ]), 1000);
  assert.equal(pickBalance([{ balance_type: 'XXXX', balance_amount: { amount: '5' } }]), 5);
  assert.equal(pickBalance([]), null);
});

test('suostumus enintään 180 pv tai pankin enimmäisaika', () => {
  const now = new Date('2026-11-15T00:00:00Z');
  assert.equal(consentValidUntil(undefined, now).toISOString().slice(0, 10), '2027-05-13');
  assert.equal(consentValidUntil(90 * 86400, now).toISOString().slice(0, 10), '2027-02-12');
});

test('hakujakso: edellinen kirjauspäivä - 3 pv, ei ennen aloituspäivää', () => {
  const from = new Date('2026-10-01T00:00:00Z');
  assert.equal(syncDateFrom(null, from), '2026-10-01');
  assert.equal(syncDateFrom(new Date('2026-11-10T00:00:00Z'), from), '2026-11-07');
  assert.equal(syncDateFrom(new Date('2026-10-02T00:00:00Z'), from), '2026-10-01');
});

test('sivutus continuation_key:llä, toistuva avain ei jää silmukkaan', async () => {
  const pages: Record<string, any> = {
    '': { transactions: [{ n: 1 }], continuation_key: 'k1' },
    k1: { transactions: [{ n: 2 }], continuation_key: 'k2' },
    k2: { transactions: [{ n: 3 }], continuation_key: null },
  };
  const all = await fetchAllTransactions({ transactionsPage: async (_u, _d, k) => pages[k ?? ''] } as any, 'u', '2026-01-01');
  assert.deepEqual(all.map((t) => t.n), [1, 2, 3]);
  const loop = await fetchAllTransactions({ transactionsPage: async () => ({ transactions: [{}], continuation_key: 'same' }) } as any, 'u', '2026-01-01');
  assert.equal(loop.length, 2);
});

const fakeClient = (txs: any[]) => ({
  calls: [] as string[],
  async transactionsPage(this: any, _uid: string, dateFrom: string) { this.calls.push(dateFrom); return { transactions: txs }; },
  async balances() { return { balances: [{ balance_type: 'CLBD', balance_amount: { amount: '1500.25' } }] }; },
});

test('synkronointi välittää kirjatut tapahtumat ja siirtää hakukohdan', async () => {
  const client = fakeClient([
    { entry_reference: 'A', transaction_amount: { amount: '100' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-11-05', reference_number: '12345' },
    { entry_reference: 'B', transaction_amount: { amount: '50' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-11-07' },
    { entry_reference: 'C', transaction_amount: { amount: '5' }, credit_debit_indicator: 'DBIT', status: 'PDNG', booking_date: '2026-11-08' },
    { entry_reference: 'D', transaction_amount: { amount: '7' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-09-30' },
  ]);
  const events: any[] = [];
  const r = await syncAccount(client as any, {
    companyId: 'c1', uid: 'u1', iban: 'FI00', syncFrom: new Date('2026-10-01T00:00:00Z'), lastBookingDate: new Date('2026-11-04T00:00:00Z'),
  }, async (e) => { events.push(e); return true; });
  assert.deepEqual(client.calls, ['2026-11-01']);
  assert.equal(r.imported, 2, 'varaus ja aloituspäivää vanhempi ohitetaan');
  assert.equal(r.lastBookingDate!.toISOString().slice(0, 10), '2026-11-07');
  assert.equal(r.balance, 1500.25);
  assert.equal(events[0].data.companyId, 'c1');
  assert.equal(events[0].data.bankAccountId, 'FI00');
  assert.deepEqual(events[0].data.transactions.map((t: any) => t.entryReference), ['A', 'B']);
});

test('synkronointi ei siirrä hakukohtaa, jos välitys epäonnistuu', async () => {
  const client = fakeClient([{ entry_reference: 'A', transaction_amount: { amount: '1' }, credit_debit_indicator: 'CRDT', booking_date: '2026-11-05' }]);
  await assert.rejects(syncAccount(client as any, { companyId: 'c', uid: 'u', syncFrom: new Date('2026-10-01') }, async () => false), /Kafka/);
});

test('ei uusia tapahtumia: ei välitystä, hakukohta ennallaan', async () => {
  const client = fakeClient([]);
  let published = false;
  const last = new Date('2026-11-04T00:00:00Z');
  const r = await syncAccount(client as any, { companyId: 'c', uid: 'u', syncFrom: new Date('2026-10-01'), lastBookingDate: last },
    async () => { published = true; return true; });
  assert.equal(published, false);
  assert.equal(r.imported, 0);
  assert.equal(r.lastBookingDate, last);
});

test('päällekkäinen haku: jo välitetyt ohitetaan, hakukohta etenee silti', async () => {
  const sent = new Set<string>(['A']);
  const seen = {
    filterNew: async (refs: string[]) => new Set(refs.filter((r) => !sent.has(r))),
    markSent: async (txs: any[]) => { txs.forEach((t) => sent.add(t.entryReference)); },
  };
  const client = fakeClient([
    { entry_reference: 'A', transaction_amount: { amount: '1' }, credit_debit_indicator: 'CRDT', booking_date: '2026-11-05' },
    { entry_reference: 'B', transaction_amount: { amount: '2' }, credit_debit_indicator: 'CRDT', booking_date: '2026-11-06' },
  ]);
  const events: any[] = [];
  const pub = async (e: any) => { events.push(e); return true; };
  const r1 = await syncAccount(client as any, { companyId: 'c', uid: 'u', syncFrom: new Date('2026-11-01') }, pub, seen);
  assert.equal(r1.imported, 1);
  assert.deepEqual(events[0].data.transactions.map((t: any) => t.entryReference), ['B']);
  const r2 = await syncAccount(client as any, { companyId: 'c', uid: 'u', syncFrom: new Date('2026-11-01') }, pub, seen);
  assert.equal(r2.imported, 0);
  assert.equal(events.length, 1);
  assert.equal(r2.lastBookingDate!.toISOString().slice(0, 10), '2026-11-06');
});
