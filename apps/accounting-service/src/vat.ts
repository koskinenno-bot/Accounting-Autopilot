/**
 * Arvonlisäverotus (puhtaat funktiot, testattavissa).
 *
 * Taloyhtiö on yleensä arvonlisäveroton (AVL 28 §), mutta KOY tai As Oy voi hakeutua verovelvolliseksi
 * kiinteistön käyttöoikeuden luovutuksesta (AVL 30 §), esim. liiketilan vuokraus. Silloin:
 *  - myynnin vero kirjataan tilille 2880 ja tuottotilin riville merkitään ALV-koodi ja veron määrä,
 *  - ostojen vähennettävä vero kirjataan tilille 1750 vähennysoikeuden prosentin mukaan (osittain verollinen
 *    käyttö); vähennyskelvoton osa jää kuluksi,
 *  - verokauden lopussa ALV-tilitys siirtää 2880 ja 1750 tilille 2885 (maksettava tai palautettava).
 * Kausiveroilmoituksen kentät ja Ilmoitin.fi-tiedosto: Verohallinnon tietuekuvaus VSRALVKV (v1.10).
 * Summat sentteinä.
 */

export const VAT_ACCOUNTS = { RECEIVABLE: '1750', PAYABLE: '2880', SETTLEMENT: '2885' } as const;
export const VAT_SETTLEMENT_TYPE = 'VAT_SETTLEMENT';

export type VatPeriodLength = 'MONTH' | 'QUARTER' | 'YEAR';

/** ALV-koodit vientirivillä. S = myynti, P = kotimainen osto (vähennys tilin 1750 kautta). */
export const VAT_CODES: Record<string, { label: string; rate?: number; kind: 'sale' | 'purchase' | 'reverse' }> = {
  S255: { label: 'Myynti 25,5 %', rate: 25.5, kind: 'sale' },
  S135: { label: 'Myynti 13,5 %', rate: 13.5, kind: 'sale' },
  S10: { label: 'Myynti 10 %', rate: 10, kind: 'sale' },
  S0: { label: 'Veroton myynti 0 %', rate: 0, kind: 'sale' },
  P: { label: 'Osto, kotimaa', kind: 'purchase' },
  RCB: { label: 'Rakentamispalvelun osto (käännetty verovelvollisuus)', rate: 25.5, kind: 'reverse' },
  RCBS: { label: 'Rakentamispalvelun myynti (käännetty)', rate: 0, kind: 'sale' },
  EUG: { label: 'Tavaraosto muusta EU-maasta', rate: 25.5, kind: 'reverse' },
  EUS: { label: 'Palveluosto muusta EU-maasta', rate: 25.5, kind: 'reverse' },
  IMP: { label: 'Maahantuonti EU:n ulkopuolelta', rate: 25.5, kind: 'reverse' },
};

export const saleCodeForRate = (rate: number): string | null =>
  rate === 25.5 ? 'S255' : rate === 13.5 ? 'S135' : rate === 10 ? 'S10' : rate === 0 ? 'S0' : null;

const c = (eur: unknown) => Math.round(Number(eur ?? 0) * 100);
const eur = (cents: number) => cents / 100;

// ---------------------------------------------------------------- verokaudet

export interface VatPeriod { key: string; length: VatPeriodLength; start: Date; end: Date; due: Date; label: string; index: number | null; year: number }

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/** "2026-11" (kuukausi), "2026-Q4" (neljännes) tai "2026" (vuosi). */
export const parsePeriod = (key: string): VatPeriod | null => {
  let m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  if (m) {
    const y = +m[1]; const mo = +m[2] - 1;
    return { key, length: 'MONTH', start: utc(y, mo, 1), end: utc(y, mo + 1, 0), due: utc(y, mo + 2, 12), label: `${mo + 1}/${y}`, index: mo + 1, year: y };
  }
  m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (m) {
    const y = +m[1]; const q = +m[2];
    return { key, length: 'QUARTER', start: utc(y, (q - 1) * 3, 1), end: utc(y, q * 3, 0), due: utc(y, q * 3 + 1, 12), label: `Q${q}/${y}`, index: q, year: y };
  }
  m = /^(\d{4})$/.exec(key);
  if (m) {
    const y = +m[1];
    // Kalenterivuoden verokausi: ilmoitus ja maksu helmikuun loppuun mennessä
    return { key, length: 'YEAR', start: utc(y, 0, 1), end: utc(y, 11, 31), due: utc(y + 1, 2, 0), label: `${y}`, index: null, year: y };
  }
  return null;
};

export const periodKeyFor = (date: Date, length: VatPeriodLength) => {
  const y = date.getUTCFullYear(); const mo = date.getUTCMonth();
  if (length === 'MONTH') return `${y}-${String(mo + 1).padStart(2, '0')}`;
  if (length === 'QUARTER') return `${y}-Q${Math.floor(mo / 3) + 1}`;
  return `${y}`;
};

export const periodsOfYear = (year: number, length: VatPeriodLength) => {
  if (length === 'YEAR') return [`${year}`];
  if (length === 'QUARTER') return [1, 2, 3, 4].map((q) => `${year}-Q${q}`);
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
};

// ---------------------------------------------------------------- kirjausrivit

export interface PostingLine { accountNumber: string; debit: number; credit: number; description?: string; vatCode?: string | null; vatAmount?: number | null }

/**
 * Ostolasku verovelvolliselle yhtiölle: kulu verottomana, vähennettävä vero 1750, vähennyskelvoton osa kuluksi.
 * Ilman veroa (tai vero ≥ summa) palautetaan tavallinen kulu / ostovelka -pari.
 */
export const purchaseLines = (input: {
  gross: number; vat: number | null | undefined; deductionPercent: number; expenseAccount: string; payableAccount: string; description: string;
}): PostingLine[] => {
  const gross = c(input.gross);
  const vat = c(input.vat);
  if (!(vat > 0) || vat >= gross) {
    return [
      { accountNumber: input.expenseAccount, debit: eur(gross), credit: 0, description: input.description },
      { accountNumber: input.payableAccount, debit: 0, credit: eur(gross), description: 'Ostovelat' },
    ];
  }
  const pct = Math.min(100, Math.max(0, Number(input.deductionPercent)));
  const deductible = Math.round((vat * pct) / 100);
  const expense = gross - deductible;
  const lines: PostingLine[] = [
    { accountNumber: input.expenseAccount, debit: eur(expense), credit: 0, description: input.description, vatCode: 'P', vatAmount: eur(vat) },
  ];
  if (deductible > 0) {
    lines.push({ accountNumber: VAT_ACCOUNTS.RECEIVABLE, debit: eur(deductible), credit: 0, description: `ALV ${pct.toLocaleString('fi-FI')} % vähennettävä` });
  }
  lines.push({ accountNumber: input.payableAccount, debit: 0, credit: eur(gross), description: 'Ostovelat' });
  return lines;
};

/**
 * Myyntilaskun tulorivit: verollinen rivi jaetaan verottomaan tuottoon (ALV-koodi ja vero riville) ja
 * veroon tilille 2880. Rivi ilman veroa kirjataan sellaisenaan.
 */
export const salesRevenueLines = (lines: { accountNumber: string; gross: number; vatRate?: number; vatAmount?: number; description?: string }[]): PostingLine[] => {
  const out: PostingLine[] = [];
  let vatTotal = 0;
  for (const l of lines) {
    const gross = c(l.gross);
    const vat = c(l.vatAmount);
    const code = l.vatRate ? saleCodeForRate(Number(l.vatRate)) : null;
    if (vat > 0 && code && vat < gross) {
      out.push({ accountNumber: l.accountNumber, debit: 0, credit: eur(gross - vat), description: l.description, vatCode: code, vatAmount: eur(vat) });
      vatTotal += vat;
    } else {
      out.push({ accountNumber: l.accountNumber, debit: 0, credit: eur(gross), description: l.description });
    }
  }
  if (vatTotal) out.push({ accountNumber: VAT_ACCOUNTS.PAYABLE, debit: 0, credit: eur(vatTotal), description: 'Arvonlisävero myynnistä' });
  return out;
};

// ---------------------------------------------------------------- kausiveroilmoitus

export interface LedgerLine { accountNumber: string; debit: unknown; credit: unknown; vatCode?: string | null; vatAmount?: unknown; entryType?: string | null }

export type VatFields = Record<'301' | '302' | '303' | '304' | '305' | '306' | '307' | '308' | '309' | '310' | '311' | '312' | '313' | '314' | '318' | '319' | '320', number>;

export const FIELD_LABELS: Record<keyof VatFields, string> = {
  301: 'Vero kotimaan myynnistä 25,5 %',
  302: 'Vero kotimaan myynnistä 13,5 %',
  303: 'Vero kotimaan myynnistä 10 %',
  304: 'Vero tavaroiden maahantuonnista EU:n ulkopuolelta',
  305: 'Vero tavaraostoista muista EU-maista',
  306: 'Vero palveluostoista muista EU-maista',
  318: 'Vero rakentamispalvelun ostoista',
  307: 'Verokauden vähennettävä vero',
  308: 'Maksettava vero / palautukseen oikeuttava vero (-)',
  309: '0-verokannan alainen liikevaihto',
  310: 'Tavaroiden maahantuonnit EU:n ulkopuolelta',
  311: 'Tavaroiden myynnit muihin EU-maihin',
  312: 'Palveluiden myynnit muihin EU-maihin',
  313: 'Tavaraostot muista EU-maista',
  314: 'Palveluostot muista EU-maista',
  319: 'Rakentamispalvelun myynnit',
  320: 'Rakentamispalvelun ostot',
};

/**
 * Kausiveroilmoituksen kentät verokauden vienneistä (senteissä). ALV-tilitysviennit jätetään pois.
 * Myynnin vero: tuottorivin ALV-koodi ja veron määrä (hyvitys = debet-rivi, vähentää). Vähennettävä vero = tilin 1750 muutos.
 * check: myynnin ja käännetyn veron summa verrattuna tilin 2880 muutokseen (ero = käsin kirjattu vero ilman koodia).
 */
export const computeVatReturn = (lines: LedgerLine[]) => {
  const f = Object.fromEntries(Object.keys(FIELD_LABELS).map((k) => [k, 0])) as VatFields;
  let payableMovement = 0;
  const uncoded: string[] = [];
  for (const l of lines) {
    if (l.entryType === VAT_SETTLEMENT_TYPE) continue;
    const debit = c(l.debit); const credit = c(l.credit);
    if (l.accountNumber === VAT_ACCOUNTS.RECEIVABLE) f[307] += debit - credit;
    if (l.accountNumber === VAT_ACCOUNTS.PAYABLE) payableMovement += credit - debit;
    const code = l.vatCode;
    if (!code) {
      continue;
    }
    if (!VAT_CODES[code]) { uncoded.push(code); continue; }
    const vat = c(l.vatAmount);
    const saleSign = credit >= debit ? 1 : -1;   // myynti kredit-rivillä, hyvitys debet-rivillä
    const buySign = debit >= credit ? 1 : -1;
    const base = Math.abs(debit - credit);
    switch (code) {
      case 'S255': f[301] += saleSign * vat; break;
      case 'S135': f[302] += saleSign * vat; break;
      case 'S10': f[303] += saleSign * vat; break;
      case 'S0': f[309] += saleSign * base; break;
      case 'RCBS': f[319] += saleSign * base; break;
      case 'RCB': f[318] += buySign * vat; f[320] += buySign * base; break;
      case 'EUG': f[305] += buySign * vat; f[313] += buySign * base; break;
      case 'EUS': f[306] += buySign * vat; f[314] += buySign * base; break;
      case 'IMP': f[304] += buySign * vat; f[310] += buySign * base; break;
      default: break; // P: vähennys tilin 1750 kautta
    }
  }
  const output = f[301] + f[302] + f[303] + f[304] + f[305] + f[306] + f[318];
  f[308] = output - f[307];
  const warnings: string[] = [];
  if (payableMovement !== output) {
    warnings.push(`Tilin 2880 muutos (${(payableMovement / 100).toFixed(2)} €) poikkeaa ALV-koodien verosta (${(output / 100).toFixed(2)} €). `
      + 'Tarkista viennit, joissa vero on kirjattu tilille 2880 ilman ALV-koodia tuottoriville.');
  }
  if (uncoded.length) warnings.push(`Tuntemattomat ALV-koodit: ${[...new Set(uncoded)].join(', ')}`);
  return { fields: f, output, payableMovement, warnings };
};

/** ALV-tilitysvienti: 2880 ja 1750 nollataan kauden osalta, erotus tilille 2885 (maksettava kredit / palautettava debet). */
export const settlementLines = (fields: VatFields, periodLabel: string): PostingLine[] => {
  const output = fields[301] + fields[302] + fields[303] + fields[304] + fields[305] + fields[306] + fields[318];
  const lines: PostingLine[] = [];
  if (output) lines.push({ accountNumber: VAT_ACCOUNTS.PAYABLE, debit: output > 0 ? eur(output) : 0, credit: output < 0 ? eur(-output) : 0, description: `ALV-velka ${periodLabel}` });
  if (fields[307]) lines.push({ accountNumber: VAT_ACCOUNTS.RECEIVABLE, debit: fields[307] < 0 ? eur(-fields[307]) : 0, credit: fields[307] > 0 ? eur(fields[307]) : 0, description: `Vähennettävä ALV ${periodLabel}` });
  const net = fields[308];
  if (net) lines.push({ accountNumber: VAT_ACCOUNTS.SETTLEMENT, debit: net < 0 ? eur(-net) : 0, credit: net > 0 ? eur(net) : 0, description: net > 0 ? `Maksettava ALV ${periodLabel}` : `Palautettava ALV ${periodLabel}` });
  return lines;
};

// ---------------------------------------------------------------- Ilmoitin.fi (VSRALVKV)

const money = (cents: number) => {
  const sign = cents < 0 ? '-' : '';
  const a = Math.abs(cents);
  return `${sign}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`;
};
const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}${p(d.getMonth() + 1)}${d.getFullYear()}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export const isBusinessId = (id: string | null | undefined) => {
  const m = /^(\d{7})-(\d)$/.exec(id || '');
  if (!m) return false;
  const w = [7, 9, 10, 5, 8, 4, 2];
  const r = m[1].split('').reduce((s, d, i) => s + Number(d) * w[i], 0) % 11;
  if (r === 1) return false;
  return Number(m[2]) === (r === 0 ? 0 : 11 - r);
};

/**
 * Kausiveroilmoitus Ilmoitin.fi-tiedostona (tunnus:arvo, desimaalipilkku). Ilman toimintaa annetaan 056:1.
 * softwareId = ohjelmiston tuottajan Y-tunnus_tunniste (kenttä 014), pakollinen Ilmoitin.fi:ssä.
 */
export const ilmoitinFile = (input: {
  fields: VatFields; period: VatPeriod; businessId: string; softwareId: string; softwareName: string; phone?: string | null; now?: Date;
}) => {
  const { fields, period } = input;
  const rows: string[] = [
    '000:VSRALVKV',
    `198:${stamp(input.now ?? new Date())}`,
    `014:${input.softwareId}`,
    `048:${input.softwareName.slice(0, 35)}`,
    `010:${input.businessId}`,
  ];
  if (input.phone) rows.push(`042:${input.phone.slice(0, 35)}`);
  rows.push(`050:${period.length === 'MONTH' ? 'K' : period.length === 'QUARTER' ? 'Q' : 'V'}`);
  if (period.index !== null) rows.push(`052:${period.index}`);
  rows.push(`053:${period.year}`);
  const order: (keyof VatFields)[] = ['301', '302', '303', '304', '305', '306', '307', '308', '309', '310', '311', '312', '313', '314', '318', '319', '320'];
  const activity = order.some((k) => fields[k] !== 0);
  if (!activity) rows.push('056:1');
  else for (const k of order) rows.push(`${k}:${money(fields[k])}`);
  rows.push('999:1');
  return `${rows.join('\r\n')}\r\n`;
};
