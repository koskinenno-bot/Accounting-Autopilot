import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShareholderCsv, splitCsvLine } from '../src/shareholderImport';

test('CSV-kenttien jako lainausmerkkeineen', () => {
  assert.deepEqual(splitCsvLine('A 1;"Virtanen; Matti";"sanoi ""hei"""', ';'), ['A 1', 'Virtanen; Matti', 'sanoi "hei"']);
});

test('isännöintijärjestelmän osakasluettelo', () => {
  const csv = '﻿Huoneisto;Pinta-ala;Osakkeet;Omistaja;Sähköposti;Henkilöt;Autopaikat\r\n'
    + 'A 1;35,5;1 - 350;Aino Esimerkki;AINO@x.fi;1;0\r\n'
    + 'A 2;52;351-870;Eero Testinen;eero@x.fi;2;1\r\n'
    + 'A 2;52;351-870;Liisa Testinen;huono-osoite;2;1\r\n'
    + 'B 10;80;;Kiinteistö Oy Malli;;0;2\r\n';
  const r = parseShareholderCsv(csv);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.apartments.map((a) => [a.number, a.squareMeters, a.shareNumbers.join(), a.persons, a.parkingSpots, a.owners.length]), [
    ['A 1', 35.5, '1-350', 1, 0, 1], ['A 2', 52, '351-870', 2, 1, 2], ['B 10', 80, '', 0, 2, 1],
  ]);
  assert.equal(r.apartments[0].owners[0].email, 'aino@x.fi');
  assert.equal(r.apartments[0].owners[0].lastName, 'Esimerkki');
  assert.ok(r.warnings.some((w) => w.includes('huono-osoite')));
  assert.ok(r.warnings.some((w) => w.startsWith('B 10: ei sähköpostia')));
});

test('pakolliset sarakkeet ja virheelliset rivit', () => {
  assert.deepEqual(parseShareholderCsv('Nimi,Email\nA,b@c.fi').errors, ['Sarake "Huoneisto" puuttuu']);
  const r = parseShareholderCsv('Huoneisto,Etunimi,Sukunimi,Pinta-ala\nA1,Matti,Meikäläinen,abc\n,Maija,M,10\nA3,,,20');
  assert.equal(r.errors.length, 3);
  assert.equal(parseShareholderCsv('Huoneisto;Omistaja').errors[0], 'Tiedostossa ei ole otsikkoriviä ja tietoja');
});
