/**
 * Veroilmoitus 4 (asunto- ja kiinteistöyhteisö: As Oy, KOY, asunto-osuuskunta) kirjanpidosta.
 * Lähde: Verohallinnon täyttöohje "Veroilmoituksen täyttöohje – asunto- ja kiinteistöyhteisö".
 * Jokaisella rivillä on kaksi saraketta: Kirjanpito ja Verotus. Verotettava tulos lasketaan Verotus-sarakkeesta;
 * negatiivinen tulos ilmoitetaan vahvistettavana tappiona.
 * Syöte: tuloslaskelmatilien toteuma luonnollisella etumerkillä (tuotot ja kulut positiivisina), euroina.
 */

export interface Form4Row { key: string; label: string; kind: 'income' | 'expense'; books: number; tax: number; accounts: string[]; note?: string }

const ROWS: { key: string; label: string; kind: 'income' | 'expense'; match: (n: number) => boolean; deductible?: boolean; note?: string }[] = [
  { key: 'vastikkeet', label: 'Vastikkeet (hoito-, rahoitus- ja pääomavastikkeet)', kind: 'income', match: (n) => n >= 3000 && n < 3100 || n >= 3900 && n < 3950 },
  { key: 'vuokrat', label: 'Vuokrat ja käyttökorvaukset', kind: 'income', match: (n) => n >= 3100 && n < 3900 },
  { key: 'korkotuotot', label: 'Korkotuotot, muut (mm. pankkitalletukset)', kind: 'income', match: (n) => n >= 3950 && n < 3960 },
  { key: 'muut_tuotot', label: 'Muut tuotot', kind: 'income', match: (n) => n >= 3960 && n < 4000 },
  { key: 'hoitokulut', label: 'Kiinteistön hoitokulut yhteensä', kind: 'expense', match: (n) => n >= 4000 && n < 6900 || n >= 7000 && n < 8000 },
  {
    key: 'poistot', label: 'Poistot', kind: 'expense', match: (n) => n >= 6900 && n < 7000,
    note: 'Verotus-sarakkeeseen vain verotuksessa vähennyskelpoinen poisto; erittely lomakkeella 62. Tarkista enimmäismäärä.',
  },
  { key: 'korkomenot', label: 'Korkomenot, muut (mm. rahoituslaitoslainat)', kind: 'expense', match: (n) => n >= 8000 && n < 9000 },
  {
    key: 'tuloverot', label: 'Tuloverot (vähennyskelvottomat)', kind: 'expense', match: (n) => n >= 9000 && n < 10000, deductible: false,
    note: 'Yhteisön omat tuloverot eivät ole vähennyskelpoisia.',
  },
];

const r2 = (x: number) => Math.round(x * 100) / 100;

export const form4 = (actual: Record<string, number>) => {
  const rows: Form4Row[] = ROWS.map((d) => ({ key: d.key, label: d.label, kind: d.kind, books: 0, tax: 0, accounts: [], note: d.note }));
  const unmatched: string[] = [];
  for (const [acc, amount] of Object.entries(actual)) {
    const n = Number(acc);
    const i = ROWS.findIndex((d) => d.match(n));
    if (i < 0) { if (amount) unmatched.push(acc); continue; }
    rows[i].books = r2(rows[i].books + amount);
    if (ROWS[i].deductible !== false) rows[i].tax = r2(rows[i].tax + amount);
    if (amount) rows[i].accounts.push(acc);
  }
  const total = (col: 'books' | 'tax', kind: 'income' | 'expense') => r2(rows.filter((r) => r.kind === kind).reduce((s, r) => s + r[col], 0));
  const booksResult = r2(total('books', 'income') - total('books', 'expense'));
  const taxResult = r2(total('tax', 'income') - total('tax', 'expense'));
  const warnings: string[] = [];
  const capital = Object.entries(actual).filter(([a, v]) => Number(a) >= 3900 && Number(a) < 3950 && v).reduce((s, [, v]) => s + v, 0);
  if (capital) {
    warnings.push(`Pääomavastikkeet (${r2(capital).toLocaleString('fi-FI')} €) on tuloutettu, joten ne ovat veronalaista tuloa. `
      + 'Jos yhtiökokous on päättänyt rahastoida ne tilikauden aikana, niiden pitää olla taseessa eikä tuloslaskelmassa.');
  }
  if (unmatched.length) warnings.push(`Tilejä ei voitu sijoittaa lomakkeelle: ${unmatched.join(', ')}`);
  return {
    rows,
    totals: {
      booksIncome: total('books', 'income'), booksExpense: total('books', 'expense'), booksResult,
      taxIncome: total('tax', 'income'), taxExpense: total('tax', 'expense'),
      taxableIncome: taxResult > 0 ? taxResult : 0,
      confirmedLoss: taxResult < 0 ? r2(-taxResult) : 0,
    },
    warnings,
  };
};
