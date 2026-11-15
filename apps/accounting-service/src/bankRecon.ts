/**
 * Pankkitäsmäytys (puhtaat funktiot). Kirjanpidon rahatilit 1900–1989 verrataan pankkien saldoihin
 * kuukauden lopussa. Pankkisaldo on kunkin tilin (IBAN) viimeisin saldo enintään kuukauden viimeiseltä päivältä.
 */

export const CASH_RANGE = ['1900', '1989'] as const;
/** Saldo on vanha, jos se on yli 4 päivää ennen täsmäytyspäivää (kuun viimeinen pankkipäivä voi olla aiemmin). */
export const STALE_DAYS = 4;
const DAY = 86_400_000;

export interface BalanceRow { iban: string; date: Date; balance: number; source: string }

export const normalizeIban = (s: string) => String(s ?? '').replace(/\s/g, '').toUpperCase();

/** IBAN-tarkiste (mod 97). */
export const isIban = (raw: string) => {
  const s = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
};

export const monthEnd = (year: number, month1: number) => new Date(Date.UTC(year, month1, 0));

/** Pankkisaldot täsmäytyspäivälle: tilikohtaisesti viimeisin saldo enintään päivältä `at`. */
export const bankBalancesAt = (rows: BalanceRow[], at: Date) => {
  const latest = new Map<string, BalanceRow>();
  for (const r of rows) {
    if (r.date > at) continue;
    const cur = latest.get(r.iban);
    if (!cur || r.date > cur.date) latest.set(r.iban, r);
  }
  const accounts = [...latest.values()]
    .sort((a, b) => a.iban.localeCompare(b.iban))
    .map((r) => ({ ...r, stale: at.getTime() - r.date.getTime() > STALE_DAYS * DAY }));
  const total = Math.round(accounts.reduce((s, a) => s + a.balance * 100, 0)) / 100;
  return { accounts, total, complete: accounts.length > 0 && accounts.every((a) => !a.stale) };
};

export type ReconStatus = 'OK' | 'DIFFERENCE' | 'NO_BALANCE' | 'STALE';

export const reconStatus = (bank: ReturnType<typeof bankBalancesAt>, book: number): { status: ReconStatus; difference: number | null } => {
  if (!bank.accounts.length) return { status: 'NO_BALANCE', difference: null };
  const difference = Math.round((bank.total - book) * 100) / 100;
  if (!bank.complete) return { status: 'STALE', difference };
  return { status: Math.abs(difference) < 0.005 ? 'OK' : 'DIFFERENCE', difference };
};
