/**
 * Siirto vanhasta kirjanpitojärjestelmästä (puhtaat funktiot, testattavissa).
 *
 * Lähtötieto on vanhan järjestelmän saldoluettelo (tilinumero, nimi, saldo tai debet ja kredit) viimeiseltä
 * suljetulta tilikaudelta. Vanhat tilit mäpätään yhtiön tilikarttaan. Mäpätyistä saldoista syntyy
 *  1) vertailuvuoden kirjaus (tuloslaskelman ja taseen vertailuluvut, KPL 3:1a §) ja
 *  2) seuraavan tilikauden avaustase (tulos siirtyy edellisten tilikausien voittoon).
 * Summat sentteinä, etumerkki debet - kredit.
 */
import { OpeningRow, RESULT_ACCOUNT, RETAINED_EARNINGS } from './closing';

export type SignMode = 'DEBIT_POSITIVE' | 'NATURAL';

export interface SourceRow { line: number; sourceAccount: string; sourceName: string; cents: number }
export interface TargetAccount { accountNumber: string; accountName: string; isActive?: boolean }
export interface Suggestion { targetAccount: string | null; how: 'saved' | 'number' | 'name' | null }

/** "1 234,56", "1.234,56", "-1234.56", "1234,56-", "€" sallitaan. */
export const parseAmount = (raw: string): number => {
  let s = (raw ?? '').replace(/[\s €]/g, '');
  if (!s) return NaN;
  let negative = false;
  if (s.endsWith('-')) { negative = true; s = s.slice(0, -1); }
  if (s.startsWith('(') && s.endsWith(')')) { negative = true; s = s.slice(1, -1); }
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return NaN;
  const cents = Math.round(Number(s) * 100);
  return negative ? -cents : cents;
};

/** Vanhan tilin luokka ensimmäisestä numerosta: 1 vastaavaa, 2 vastattavaa, 3 tuotot, 4–9 kulut. */
const sourceClass = (acc: string) => {
  const d = Number(acc[0]);
  if (d === 1) return 'ASSET';
  if (d === 2) return 'EQUITY_LIABILITY';
  if (d === 3) return 'INCOME';
  return 'EXPENSE';
};
const creditNormal = (acc: string) => ['EQUITY_LIABILITY', 'INCOME'].includes(sourceClass(acc));

/**
 * Saldoluettelo tekstinä (CSV, puolipiste tai sarkain; kopio Excelistä käy).
 * Sarakkeet: tili;nimi;saldo tai tili;nimi;debet;kredit tai tili;saldo. Otsikko- ja summarivit ohitetaan.
 * signMode NATURAL: tuotot, velat ja oma pääoma positiivisina (käännetään). DEBIT_POSITIVE: kredit-saldot miinuksella.
 */
export const parseTrialBalance = (text: string, signMode: SignMode) => {
  const rows: SourceRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, SourceRow>();
  (text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/[;\t]/).map((p) => p.trim().replace(/^"|"$/g, ''));
    const acc = parts[0];
    if (!/^\d{3,8}$/.test(acc)) return; // otsikko, väliotsikko tai summarivi
    let name = '';
    let cents: number;
    if (parts.length >= 4) {
      name = parts[1];
      const debit = parts[2] ? parseAmount(parts[2]) : 0;
      const credit = parts[3] ? parseAmount(parts[3]) : 0;
      cents = Number.isNaN(debit) || Number.isNaN(credit) ? NaN : debit - credit;
    } else if (parts.length === 3) {
      name = parts[1];
      cents = parseAmount(parts[2]);
      if (!Number.isNaN(cents) && signMode === 'NATURAL' && creditNormal(acc)) cents = -cents;
    } else if (parts.length === 2) {
      cents = parseAmount(parts[1]);
      if (!Number.isNaN(cents) && signMode === 'NATURAL' && creditNormal(acc)) cents = -cents;
    } else {
      errors.push(`Rivi ${i + 1}: saldo puuttuu (${line.slice(0, 40)})`);
      return;
    }
    if (Number.isNaN(cents)) {
      errors.push(`Rivi ${i + 1}: tilin ${acc} saldo ei ole luku`);
      return;
    }
    const prev = seen.get(acc);
    if (prev) {
      prev.cents += cents;
      warnings.push(`Tili ${acc} on luettelossa useasti; saldot laskettiin yhteen`);
      return;
    }
    const row = { line: i + 1, sourceAccount: acc, sourceName: name, cents };
    seen.set(acc, row);
    rows.push(row);
  });
  if (!rows.length && !errors.length) errors.push('Saldoluettelosta ei löytynyt tilirivejä (tilinumero ensimmäisessä sarakkeessa)');
  return { rows: rows.filter((r) => r.cents !== 0), errors, warnings };
};

// Taloyhtiöiden tilien yleiset rinnakkaisnimet (vanha nimi -> tilikartan sana)
const SYNONYMS: [RegExp, string][] = [
  [/^rahoitusvastik/, 'pääomavastikkeet'],
  [/^lainanlyhennysvastik/, 'pääomavastikkeet'],
  [/^lämpö/, 'lämmitys'],
  [/^korot$|^korkokulu/, 'korot'],
  [/^kiinteistönhoi|^huolto/, 'huolto'],
  [/^isännöin/, 'isännöinti'],
];
const normalize = (t: string) => SYNONYMS.find(([re]) => re.test(t))?.[1] ?? t;
const tokens = (s: string) => (s || '').toLowerCase().replace(/[^a-zåäö0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 2).map(normalize);
/** Nimien samankaltaisuus 0–1: yhteiset sanat (5 ensimmäisen kirjaimen perusteella, taivutusmuodot). */
export const nameSimilarity = (a: string, b: string) => {
  const ta = [...new Set(tokens(a).map((t) => t.slice(0, 5)))];
  const tb = new Set(tokens(b).map((t) => t.slice(0, 5)));
  if (!ta.length || !tb.size) return 0;
  const common = ta.filter((t) => tb.has(t)).length;
  return common / Math.max(ta.length, tb.size);
};

const targetInClass = (cls: string, acc: string) => {
  const n = Number(acc);
  if (cls === 'ASSET') return n >= 1000 && n <= 1999;
  if (cls === 'EQUITY_LIABILITY') return n >= 2000 && n <= 2999;
  if (cls === 'INCOME') return n >= 3000 && n <= 3999;
  return n >= 4000 && n <= 9999;
};

/** Ehdotus kohdetiliksi: tallennettu mäppäys, sama tilinumero samassa luokassa tai lähin nimi samassa luokassa. */
export const suggestTarget = (row: { sourceAccount: string; sourceName: string }, targets: TargetAccount[],
  saved: Map<string, string>): Suggestion => {
  const s = saved.get(row.sourceAccount);
  if (s && targets.some((t) => t.accountNumber === s)) return { targetAccount: s, how: 'saved' };
  const cls = sourceClass(row.sourceAccount);
  const candidates = targets.filter((t) => t.isActive !== false && targetInClass(cls, t.accountNumber));
  const same = candidates.find((t) => t.accountNumber === row.sourceAccount);
  if (same && (!row.sourceName || nameSimilarity(row.sourceName, same.accountName) > 0)) {
    return { targetAccount: same.accountNumber, how: 'number' };
  }
  let best: TargetAccount | null = null;
  let bestScore = 0;
  for (const t of candidates) {
    const score = nameSimilarity(row.sourceName, t.accountName);
    if (score > bestScore) { best = t; bestScore = score; }
  }
  if (best && bestScore >= 0.5) return { targetAccount: best.accountNumber, how: 'name' };
  // Sama numero eri nimellä: heikko ehdotus, käyttäjä tarkistaa
  return same ? { targetAccount: same.accountNumber, how: 'number' } : { targetAccount: null, how: null };
};

export interface MappedLine { accountNumber: string; debit: number; credit: number; description: string }

/** Mäpätyt saldot kohdetileittäin (senttejä, debet - kredit). Heittää, jos jokin rivi on mäppäämättä. */
export const aggregate = (rows: SourceRow[], mapping: Record<string, string>) => {
  const out = new Map<string, number>();
  const missing = rows.filter((r) => !mapping[r.sourceAccount]);
  if (missing.length) throw new Error(`Mäppäämättä ${missing.length} tiliä: ${missing.slice(0, 5).map((r) => r.sourceAccount).join(', ')}`);
  for (const r of rows) {
    const t = mapping[r.sourceAccount];
    out.set(t, (out.get(t) ?? 0) + r.cents);
  }
  return out;
};

export const totals = (balances: Map<string, number>) => {
  let debit = 0;
  let credit = 0;
  let result = 0;
  for (const [acc, c] of balances) {
    if (c > 0) debit += c; else credit -= c;
    if (Number(acc) >= 3000) result -= c;
  }
  return { debit, credit, difference: debit - credit, result };
};

/** Vertailuvuoden kirjaus: yksi vienti, jossa kaikkien tilien saldot. Saldoluettelon on täsmättävä. */
export const migrationLines = (balances: Map<string, number>): MappedLine[] => {
  const t = totals(balances);
  if (t.difference !== 0) {
    throw new Error(`Saldoluettelo ei täsmää: debet ${(t.debit / 100).toFixed(2)} € ja kredit ${(t.credit / 100).toFixed(2)} € `
      + `(ero ${(t.difference / 100).toFixed(2)} €). Jos tilikauden tulos on mukana taseessa omana rivinään, poista se rivi.`);
  }
  return [...balances].filter(([, c]) => c !== 0).sort(([a], [b]) => a.localeCompare(b)).map(([accountNumber, c]) => ({
    accountNumber, debit: c > 0 ? c / 100 : 0, credit: c < 0 ? -c / 100 : 0, description: 'Siirto vanhasta järjestelmästä',
  }));
};

/** Seuraavan tilikauden avaustase: taseen tilit, tulos (ja mahdollinen 2200) edellisten tilikausien voittoon. */
export const openingRowsFrom = (balances: Map<string, number>): OpeningRow[] => {
  const natural = new Map<string, number>();
  let retained = 0;
  for (const [acc, c] of balances) {
    const n = Number(acc);
    if (n >= 3000) retained -= c;                      // tulos: tuotot (kredit) kasvattavat omaa pääomaa
    else if (acc === RESULT_ACCOUNT) retained -= c;
    else natural.set(acc, n < 2000 ? c : -c);
  }
  natural.set(RETAINED_EARNINGS, (natural.get(RETAINED_EARNINGS) ?? 0) + retained);
  return [...natural].filter(([, c]) => c !== 0).sort(([a], [b]) => a.localeCompare(b))
    .map(([accountNumber, c]) => ({ accountNumber, balance: c / 100 }));
};
