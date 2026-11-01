/** Kirjanpitovientien puhtaat tarkistusfunktiot (testattavissa ilman tietokantaa). */

/** Muuntaa euromäärän kokonaisiksi senteiksi (välttää liukulukuvirheet). Palauttaa NaN virheelliselle. */
export const toCents = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

/** Tarkistaa vientirivit. Palauttaa virheilmoituksen tai null. */
export const validateLines = (lines: any): string | null => {
  if (!Array.isArray(lines) || lines.length < 2) {
    return 'Kirjanpitoviennissä on oltava vähintään kaksi riviä';
  }
  let debit = 0;
  let credit = 0;
  for (const [i, line] of lines.entries()) {
    if (!line?.accountNumber) return `Rivi ${i + 1}: tilinumero puuttuu`;
    const d = toCents(line.debit);
    const c = toCents(line.credit);
    if (Number.isNaN(d) || Number.isNaN(c)) return `Rivi ${i + 1}: virheellinen summa`;
    if (d < 0 || c < 0) return `Rivi ${i + 1}: summat eivät voi olla negatiivisia`;
    if (d > 0 && c > 0) return `Rivi ${i + 1}: rivillä voi olla joko debet tai kredit, ei molempia`;
    if (d === 0 && c === 0) return `Rivi ${i + 1}: rivin summa on nolla`;
    debit += d;
    credit += c;
  }
  if (debit !== credit) {
    return `Balance error: Debit (${(debit / 100).toFixed(2)}) and Credit (${(credit / 100).toFixed(2)}) must be equal (KPL 2:2 §)`;
  }
  return null;
};
