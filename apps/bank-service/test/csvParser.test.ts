import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { decodeStatement, parseBankCsv, parseFinnishAmount, parseFinnishDate, CsvFormatError } from '../src/services/csvParser';

const sample = (name: string) =>
  parseBankCsv(decodeStatement(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'scripts', 'samples', 'tiliotteet', name))));

test('summat ja päivämäärät suomalaisessa muodossa', () => {
  assert.equal(parseFinnishAmount('-1 452,36'), -1452.36);
  assert.equal(parseFinnishAmount('1.452,36'), 1452.36);
  assert.equal(parseFinnishAmount('+250,00 €'), 250);
  assert.equal(parseFinnishAmount('-12.50'), -12.5);
  assert.ok(Number.isNaN(parseFinnishAmount('')));
  assert.equal(parseFinnishDate('5.11.2026'), '2026-11-05');
  assert.equal(parseFinnishDate('05.11.26'), '2026-11-05');
  assert.equal(parseFinnishDate('2026/11/05'), '2026-11-05');
  assert.equal(parseFinnishDate('31.2.2026'), null);
});

test('Nordea: erilliset maksaja- ja saajasarakkeet, vastapuoli suunnan mukaan', () => {
  const txs = sample('nordea.csv');
  assert.equal(txs.length, 3);
  assert.deepEqual(
    [txs[0].creditDebit, txs[0].amount, txs[0].counterpartyName, txs[0].referenceNumber],
    ['CRDT', 157.5, 'Aino Esimerkki', '490710078'],
  );
  assert.deepEqual([txs[1].creditDebit, txs[1].amount, txs[1].counterpartyName], ['DBIT', 1389.4, 'Kaukolämpö Esimerkki Oy']);
  assert.equal(txs[2].counterpartyName, 'Demopankki Oyj');
});

test('OP: ISO-8859-1, "Määrä EUROA", arkistointitunnus ja IBAN', () => {
  const txs = sample('op.csv');
  assert.equal(txs[1].counterpartyName, 'Isännöintitoimisto Malli Oy');
  assert.equal(txs[1].amount, 650);
  assert.equal(txs[1].payerIban, 'FI8845678900004455');
  assert.equal(txs[1].entryReference, '20261114/593497/000001');
});

test('S-Pankki, Danske (pilkku + lainausmerkit) ja Aktia (pano/otto, tilitiedot ennen otsikkoa)', () => {
  const s = sample('s-pankki.csv');
  assert.deepEqual([s[0].creditDebit, s[0].counterpartyName, s[0].amount], ['DBIT', 'Esimerkin Vesi Oy', 402.15]);
  assert.deepEqual([s[1].creditDebit, s[1].counterpartyName], ['CRDT', 'Liisa Malli']);

  const d = sample('danske.csv');
  assert.deepEqual([d[0].bookingDate, d[0].amount, d[0].remittanceInfo], ['2026-11-18', 198.6, 'S-301977']);

  const a = sample('aktia.csv');
  assert.equal(a.length, 3);
  assert.deepEqual([a[0].creditDebit, a[0].amount], ['CRDT', 333]);
  assert.deepEqual([a[1].creditDebit, a[1].amount, a[1].counterpartyName], ['DBIT', 86, 'Lukkoliike Avain Oy']);
});

test('tunniste ilman arkistointitunnusta on pysyvä ja erottaa samanlaiset rivit', () => {
  const first = sample('danske.csv').map((t) => t.entryReference);
  const again = sample('danske.csv').map((t) => t.entryReference);
  assert.deepEqual(first, again);
  assert.equal(new Set(first).size, first.length);
  const twins = parseBankCsv('Pvm;Määrä;Nimi\n1.11.2026;-10,00;Kahvila\n1.11.2026;-10,00;Kahvila\n');
  assert.notEqual(twins[0].entryReference, twins[1].entryReference);
});

test('tuntematon muoto antaa selkeän virheen', () => {
  assert.throws(() => parseBankCsv('a;b;c\n1;2;3'), CsvFormatError);
});
