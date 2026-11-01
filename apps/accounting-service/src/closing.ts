/**
 * Avaussaldojen, poistojen ja tilinpäätöksen puhtaat laskentafunktiot (testattavissa ilman kantaa).
 * Summat käsitellään sentteinä.
 */

export const RESULT_ACCOUNT = '2200';          // Tilikauden tulos
export const RETAINED_EARNINGS = '2100';       // Edellisten tilikausien voitto/tappio
export const DEPRECIATION_ACCOUNT = '6900';    // Poistot
export const ACCRUED_EXPENSES = '2900';        // Siirtovelat
export const ACCRUED_INCOME = '1800';          // Siirtosaamiset

const num = (acc: string) => (/^\d{4}/.test(acc) ? Number(acc.slice(0, 4)) : -1);
export const isBalanceSheetAccount = (acc: string) => num(acc) >= 1000 && num(acc) <= 2999;
export const isProfitAndLossAccount = (acc: string) => num(acc) >= 3000 && num(acc) <= 9999;
/** Vastaavaa (1xxx) on debet-saldoinen, vastattavaa (2xxx) kredit-saldoinen. */
const isAssetAccount = (acc: string) => num(acc) >= 1000 && num(acc) <= 1999;

export interface Line { accountNumber: string; debit: number; credit: number; description?: string }

const toCents = (v: unknown) => Math.round(Number(v) * 100);
const fromCents = (c: number) => Math.round(c) / 100;

export interface OpeningRow { accountNumber: string; balance: number; name?: string }

/**
 * Avaustaseen rivit vientiriveiksi. Saldo annetaan "luonnollisena" positiivisena lukuna:
 * vastaavaa debetiin, vastattavaa kreditiin; negatiivinen saldo kääntää puolen.
 * Heittää virheen, jos rivi ei ole tasetili tai debet ja kredit eivät täsmää.
 */
export const buildOpeningLines = (rows: OpeningRow[]): Line[] => {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Avaussaldoja ei annettu');
  const lines: Line[] = [];
  for (const [i, row] of rows.entries()) {
    const acc = String(row.accountNumber || '').trim();
    if (!isBalanceSheetAccount(acc)) throw new Error(`Rivi ${i + 1}: tili ${acc || '-'} ei ole tasetili (1000–2999)`);
    const cents = toCents(row.balance);
    if (Number.isNaN(cents)) throw new Error(`Rivi ${i + 1}: virheellinen saldo`);
    if (cents === 0) continue;
    const debitSide = isAssetAccount(acc) ? cents > 0 : cents < 0;
    const amount = fromCents(Math.abs(cents));
    lines.push({ accountNumber: acc, debit: debitSide ? amount : 0, credit: debitSide ? 0 : amount, description: row.name || 'Avaussaldo' });
  }
  const debit = lines.reduce((s, l) => s + toCents(l.debit), 0);
  const credit = lines.reduce((s, l) => s + toCents(l.credit), 0);
  if (debit !== credit) {
    throw new Error(`Avaustase ei täsmää: vastaavaa ${fromCents(debit).toFixed(2)} € ≠ vastattavaa ${fromCents(credit).toFixed(2)} €`);
  }
  if (lines.length < 2) throw new Error('Avaustaseessa on oltava vähintään kaksi saldoa');
  return lines;
};

export interface AssetLike {
  method: string;                // DECLINING | STRAIGHT_LINE | MANUAL
  acquisitionCost: number;
  rate?: number | null;          // %
  usefulLifeYears?: number | null;
  manualAmount?: number | null;
}

/** Tilikauden poisto. bookValue = kirjanpitoarvo tilikauden alussa. Ei koskaan yli kirjanpitoarvon. */
export const depreciationFor = (asset: AssetLike, bookValue: number): number => {
  const bv = Math.max(0, toCents(bookValue));
  let cents = 0;
  if (asset.method === 'DECLINING') cents = Math.round((bv * Number(asset.rate || 0)) / 100);
  else if (asset.method === 'STRAIGHT_LINE') {
    const years = Number(asset.usefulLifeYears || 0);
    cents = years > 0 ? Math.round(toCents(asset.acquisitionCost) / years) : 0;
  } else if (asset.method === 'MANUAL') cents = toCents(asset.manualAmount || 0);
  return fromCents(Math.min(Math.max(cents, 0), bv));
};

/**
 * Tilinpäätösvienti: tulostilien saldot nollataan ja erotus kirjataan tilille 2200.
 * balances: tili -> saldo senteinä (debet - kredit). Palauttaa rivit ja tuloksen euroina (voitto > 0).
 */
export const buildClosingLines = (balances: Record<string, number>): { lines: Line[]; result: number } => {
  const lines: Line[] = [];
  let net = 0; // debet - kredit tulostileillä; voitto => negatiivinen
  for (const [acc, cents] of Object.entries(balances).sort()) {
    if (!isProfitAndLossAccount(acc) || cents === 0) continue;
    net += cents;
    lines.push(cents > 0
      ? { accountNumber: acc, debit: 0, credit: fromCents(cents), description: 'Tulostilin päättäminen' }
      : { accountNumber: acc, debit: fromCents(-cents), credit: 0, description: 'Tulostilin päättäminen' });
  }
  if (net !== 0) {
    lines.push(net > 0
      ? { accountNumber: RESULT_ACCOUNT, debit: fromCents(net), credit: 0, description: 'Tilikauden tappio' }
      : { accountNumber: RESULT_ACCOUNT, debit: 0, credit: fromCents(-net), description: 'Tilikauden voitto' });
  }
  return { lines, result: fromCents(-net) };
};

/**
 * Seuraavan tilikauden avausvienti päättyneen kauden tasetilien saldoista.
 * Tilikauden tulos (2200) siirretään edellisten tilikausien voittoon (2100).
 */
export const buildCarryForwardLines = (balances: Record<string, number>): Line[] => {
  const carried: Record<string, number> = {};
  for (const [acc, cents] of Object.entries(balances)) {
    if (!isBalanceSheetAccount(acc) || cents === 0) continue;
    const target = acc === RESULT_ACCOUNT ? RETAINED_EARNINGS : acc;
    carried[target] = (carried[target] || 0) + cents;
  }
  return Object.entries(carried)
    .filter(([, c]) => c !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([acc, c]) => ({
      accountNumber: acc,
      debit: c > 0 ? fromCents(c) : 0,
      credit: c < 0 ? fromCents(-c) : 0,
      description: 'Avaussaldo edelliseltä tilikaudelta',
    }));
};

/** Saldot vientiriveistä: tili -> debet - kredit senteinä. */
export const balancesFromLines = (lines: { accountNumber: string; debit: unknown; credit: unknown }[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const l of lines) out[l.accountNumber] = (out[l.accountNumber] || 0) + toCents(l.debit) - toCents(l.credit);
  return out;
};
