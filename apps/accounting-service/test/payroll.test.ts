import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RATES, computePayslip, contractReportDue, contractsForMonth, employerPaymentDue, employerReportDue, maskHetu, parseHetu,
  payrollLines, sumSlips, wageReportDue, withholding,
} from '../src/payroll';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const pay = new Date('2026-11-20T00:00:00Z');

test('henkilötunnus: tarkiste, vuosisata ja peitto', () => {
  assert.equal(iso(parseHetu('131052-308T')!.birthDate), '1952-10-13');
  assert.equal(iso(parseHetu('010101A123N')!.birthDate), '2001-01-01');
  assert.equal(parseHetu('131052-308U'), null, 'väärä tarkiste');
  assert.equal(parseHetu('310252-308T'), null, 'virheellinen päivä');
  assert.equal(maskHetu('131052-308T'), '131052-****');
});

test('ennakonpidätys: verokortti, tuloraja ja ilman verokorttia 60 %', () => {
  assert.equal(withholding(10000, null), 6000);
  assert.equal(withholding(10000, { percent: 20 }), 2000);
  // tuloraja 1000 €, aiemmin 950 € => 50 € 20 %:lla, 50 € 40 %:lla
  assert.equal(withholding(10000, { percent: 20, additionalPercent: 40, incomeLimit: 1000 }, 95000), 1000 + 2000);
  assert.equal(withholding(333, { percent: 15.5 }), 51, 'pyöristys alaspäin');
});

test('kokouspalkkio: ei sosiaalivakuutusmaksuja, vain ennakonpidätys', () => {
  const s = computePayslip({ name: 'Hallitus', hetu: '131052-308T', taxCard: { percent: 25 } }, [{ incomeType: '210', amount: 150 }], DEFAULT_RATES, pay);
  assert.deepEqual([s.gross, s.withholding, s.net, s.healthEmployer, s.tyelEmployer, s.tyelEmployee], [15000, 3750, 11250, 0, 0, 0]);
  assert.deepEqual(s.warnings, []);
});

test('aikapalkka: TyEL, työttömyys ja sv-maksu, kirjaus täsmää', () => {
  const s = computePayslip({ name: 'Talonmies', hetu: '010101A123N', taxCard: { percent: 10 } }, [{ incomeType: '201', amount: 1000 }], DEFAULT_RATES, pay);
  assert.equal(s.withholding, 10000);
  assert.equal(s.tyelEmployee, 7300);
  assert.equal(s.unemploymentEmployee, 890);
  assert.equal(s.net, 100000 - 10000 - 7300 - 890);
  assert.equal(s.tyelEmployer, 25850 - 7300);
  assert.equal(s.unemploymentEmployer, 310);
  assert.equal(s.healthEmployer, 1910);
  const lines = payrollLines([s], 'Palkat 11/2026');
  const d = Math.round(lines.reduce((x, l) => x + l.debit * 100, 0));
  const c = Math.round(lines.reduce((x, l) => x + l.credit * 100, 0));
  assert.equal(d, c);
  assert.deepEqual(lines.map((l) => l.accountNumber), ['4010', '4020', '2840', '2850', '2855']);
  assert.equal(sumSlips([s]).employerCost, 18550 + 310 + 1910);
});

test('ikärajat ja TyEL-alaraja, puuttuva henkilötunnus varoittaa', () => {
  const old = computePayslip({ name: 'Eläkeläinen', hetu: '131052-308T', taxCard: { percent: 10 } }, [{ incomeType: '201', amount: 500 }], DEFAULT_RATES, pay);
  assert.deepEqual([old.age, old.tyelEmployee, old.unemploymentEmployee, old.healthEmployer], [74, 0, 0, 0]);
  const small = computePayslip({ name: 'Nuori', hetu: '010101A123N', taxCard: { percent: 0 } }, [{ incomeType: '201', amount: 50 }], DEFAULT_RATES, pay);
  assert.equal(small.tyelEmployee, 0);
  assert.equal(small.unemploymentEmployee, 45);
  const noId = computePayslip({ name: 'X', hetu: null, taxCard: null }, [{ incomeType: '215', amount: 100 }], DEFAULT_RATES, pay);
  assert.equal(noId.warnings.length, 2);
  assert.equal(noId.healthEmployer, 191, 'luottamustoimipalkkio: sv-maksu');
});

test('määräpäivät', () => {
  assert.equal(iso(wageReportDue(new Date('2026-11-28T00:00:00Z'))), '2026-12-03');
  assert.equal(iso(employerReportDue(2026, 12)), '2027-01-05');
  assert.equal(iso(employerPaymentDue(2026, 11)), '2026-12-12');
  assert.equal(iso(contractReportDue(2026, 7)), '2026-09-05');
});

test('urakkatiedot: yli 15 000 €, laskutus kuukaudelta alv 0', () => {
  const contracts = [
    { id: 'a', contractorName: 'Rakennus Oy', contractorBusinessId: '0737546-2', value: 80000, startDate: new Date('2026-10-01'), endDate: null },
    { id: 'b', contractorName: 'Pieni Oy', contractorBusinessId: '1572860-0', value: 15000, startDate: new Date('2026-11-01'), endDate: null },
    { id: 'c', contractorName: 'Alkaa Oy', contractorBusinessId: '1234567-1', value: 20000, startDate: new Date('2026-11-10'), endDate: null },
  ];
  const invoices = [
    { supplierBusinessId: '0737546-2', invoiceDate: new Date('2026-11-15'), totalAmount: 12550, vatAmount: 2550 },
    { supplierBusinessId: '0737546-2', invoiceDate: new Date('2026-10-15'), totalAmount: 999, vatAmount: 0 },
    { supplierBusinessId: '1572860-0', invoiceDate: new Date('2026-11-15'), totalAmount: 15000, vatAmount: 0 },
  ];
  const rows = contractsForMonth(contracts, invoices, 2026, 11);
  assert.deepEqual(rows.map((r) => [r.id, r.invoiced, r.starts]), [['a', 10000, false], ['c', 0, true]]);
});
