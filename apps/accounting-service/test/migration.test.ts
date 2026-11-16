import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, migrationLines, nameSimilarity, openingRowsFrom, parseAmount, parseDate, parseOpenPayables, parseTrialBalance, suggestTarget } from '../src/migration';
import { buildOpeningLines } from '../src/closing';

test('summat: suomalaiset ja vanhat muodot', () => {
  assert.equal(parseAmount('1 234,56'), 123456);
  assert.equal(parseAmount('1.234,56'), 123456);
  assert.equal(parseAmount('-1234.5'), -123450);
  assert.equal(parseAmount('99,90-'), -9990);
  assert.equal(parseAmount('(10,00)'), -1000);
  assert.equal(parseAmount('12 €'), 1200);
  assert.ok(Number.isNaN(parseAmount('abc')));
});

const TB = `Saldoluettelo 31.12.2025
Tili;Nimi;Saldo
1100;Rakennukset;500 000,00
1910;Pankkitili;20 000,00
2000;Osakepääoma;-100 000,00
2250;Ed. tilikausien voitto;-15 000,00
2600;Lainat;-400 000,00
3000;Hoitovastikkeet;-60 000,00
4400;Lämpö;30 000,00
4401;Lämpö;5 000,00
7700;Korot;20 000,00
Yhteensä;;0,00`;

test('saldoluettelo: otsikot ohitetaan, debet positiivisena', () => {
  const p = parseTrialBalance(TB, 'DEBIT_POSITIVE');
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows.length, 9);
  assert.equal(p.rows.find((r) => r.sourceAccount === '2600')!.cents, -40000000);
});

test('saldoluettelo: luonnollinen etumerkki ja debet/kredit-sarakkeet', () => {
  const n = parseTrialBalance('3000;Vastikkeet;60 000\n4400;Lämpö;30 000\n2000;Osakepääoma;100', 'NATURAL');
  assert.deepEqual(n.rows.map((r) => r.cents), [-6000000, 3000000, -10000]);
  const dc = parseTrialBalance('1910\tPankki\t100,00\t\n2600\tLaina\t\t100,00', 'NATURAL');
  assert.deepEqual(dc.rows.map((r) => r.cents), [10000, -10000]);
  const dup = parseTrialBalance('1910;Pankki;5\n1910;Pankki;6', 'DEBIT_POSITIVE');
  assert.equal(dup.rows[0].cents, 1100);
  assert.equal(dup.warnings.length, 1);
  assert.equal(parseTrialBalance('1910;Pankki;xx', 'DEBIT_POSITIVE').errors.length, 1);
});

const TARGETS = [
  { accountNumber: '1010', accountName: 'Rakennukset ja rakennelmat' },
  { accountNumber: '1910', accountName: 'Pankkitili' },
  { accountNumber: '2000', accountName: 'Osakepääoma' },
  { accountNumber: '2100', accountName: 'Edellisten tilikausien voitto/tappio' },
  { accountNumber: '2500', accountName: 'Lainat rahoituslaitoksilta' },
  { accountNumber: '3000', accountName: 'Hoitovastikkeet' },
  { accountNumber: '4510', accountName: 'Lämmitys' },
  { accountNumber: '8000', accountName: 'Korkokulut' },
];

test('mäppäysehdotukset: tallennettu, numero, nimi', () => {
  const saved = new Map([['4400', '4510']]);
  assert.deepEqual(suggestTarget({ sourceAccount: '4400', sourceName: 'Lämpö' }, TARGETS, saved), { targetAccount: '4510', how: 'saved' });
  assert.deepEqual(suggestTarget({ sourceAccount: '1910', sourceName: 'Pankkitili' }, TARGETS, new Map()), { targetAccount: '1910', how: 'number' });
  assert.deepEqual(suggestTarget({ sourceAccount: '1100', sourceName: 'Rakennukset' }, TARGETS, new Map()), { targetAccount: '1010', how: 'name' });
  assert.deepEqual(suggestTarget({ sourceAccount: '2250', sourceName: 'Edellisten tilikausien voitto' }, TARGETS, new Map()), { targetAccount: '2100', how: 'name' });
  // Eri luokan tiliä ei ehdoteta, vaikka nimi täsmäisi
  assert.equal(suggestTarget({ sourceAccount: '7700', sourceName: 'Pankkitili' }, TARGETS, new Map()).targetAccount, null);
  assert.ok(nameSimilarity('Lainat', 'Lainat rahoituslaitoksilta') >= 0.5);
  const more = [...TARGETS, { accountNumber: '3900', accountName: 'Pääomavastikkeet' }, { accountNumber: '3960', accountName: 'Muut rahoitustuotot' }];
  assert.equal(suggestTarget({ sourceAccount: '3050', sourceName: 'Rahoitusvastikkeet' }, more, new Map()).targetAccount, '3900');
  assert.equal(suggestTarget({ sourceAccount: '4400', sourceName: 'Lämpö' }, more, new Map()).targetAccount, '4510');
});

const MAP = { 1100: '1010', 1910: '1910', 2000: '2000', 2250: '2100', 2600: '2500', 3000: '3000', 4400: '4510', 4401: '4510', 7700: '8000' };

test('vertailuvuoden vienti ja avaustase', () => {
  const p = parseTrialBalance(TB, 'DEBIT_POSITIVE');
  const bal = aggregate(p.rows, MAP);
  assert.equal(bal.get('4510'), 3500000);
  const lines = migrationLines(bal);
  assert.equal(lines.reduce((s, l) => s + l.debit, 0), lines.reduce((s, l) => s + l.credit, 0));
  const opening = openingRowsFrom(bal);
  // Tulos 60 000 - 35 000 - 20 000 = 5 000 siirtyy edellisten tilikausien voittoon: 15 000 + 5 000
  assert.deepEqual(opening, [
    { accountNumber: '1010', balance: 500000 }, { accountNumber: '1910', balance: 20000 }, { accountNumber: '2000', balance: 100000 },
    { accountNumber: '2100', balance: 20000 }, { accountNumber: '2500', balance: 400000 },
  ]);
  assert.equal(buildOpeningLines(opening).length, 5);
});

test('virheet: mäppäämätön tili ja täsmäämätön luettelo', () => {
  const p = parseTrialBalance(TB, 'DEBIT_POSITIVE');
  assert.throws(() => aggregate(p.rows, { ...MAP, 7700: '' }), /Mäppäämättä 1 tiliä: 7700/);
  const bad = parseTrialBalance('1910;Pankki;100\n2000;Osakepääoma;-90', 'DEBIT_POSITIVE');
  assert.throws(() => migrationLines(aggregate(bad.rows, { 1910: '1910', 2000: '2000' })), /ei täsmää.*ero 10.00/);
});

test('avoimet ostolaskut: sarakkeet otsikoista, summat ja päivät', () => {
  const r = parseOpenPayables('Avoimet 31.12.2024\nToimittaja;Laskupäivä;Laskunumero;Summa;Eräpäivä;Viite;Tilinumero\nHuolto Oy;20.12.2024;H-1;4 120,00;15.1.2025;1232;FI21 1234 5600 0007 85\nSähkö Oy;;S-9;2000;2025-01-20;;\nYhteensä;;;6 120,00;;;');
  assert.deepEqual(r.errors, []);
  assert.equal(r.items.length, 2);
  assert.equal(r.totalCents, 612000);
  assert.deepEqual([r.items[0].invoiceNumber, r.items[0].invoiceDate, r.items[0].dueDate, r.items[0].iban], ['H-1', '2024-12-20', '2025-01-15', 'FI2112345600000785']);
  assert.equal(r.items[1].referenceNumber, null);
  assert.equal(parseDate('31.2.2025'), null);
  assert.match(parseOpenPayables('Tili;Saldo\n2800;100').errors.join(), /Otsikkoriviä/);
  assert.match(parseOpenPayables('Toimittaja;Summa\nA;-5').errors.join(), /positiivinen/);
});