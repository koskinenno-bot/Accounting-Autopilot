/**
 * Palkat ja palkkiot (puhtaat funktiot, testattavissa).
 *
 * Taloyhtiön tyypilliset suoritukset: hallituksen kokouspalkkiot, puheenjohtajan palkkio ja pienet palkat
 * (esim. talonmies). Isännöintitoimiston laskut ovat työkorvausta eivätkä kuulu tähän.
 *
 * Tulolajit ja oletusvakuuttaminen: Tulorekisterin koodisto (palkkojen tulolajit 200-sarja ja 308).
 *   201 Aikapalkka               TyEL, työttömyys, sairausvakuutus, tapaturma
 *   210 Kokouspalkkio            ei sosiaalivakuutusmaksuja (työnantajan sv-maksua ei makseta)
 *   215 Luottamustoimipalkkio    vain sairausvakuutus
 *   308 Hallintoelimen jäsenyydestä maksettu palkkio  ei sosiaalivakuutusmaksuja
 *
 * Maksut 2026 (Kela, ETK, työeläkeyhtiöt): työnantajan sv-maksu 1,91 %, TyEL keskimäärin 24,40 %
 * (tilapäinen työnantaja 25,85 %), työntekijän TyEL 7,30 %, työttömyysvakuutus työnantaja 0,31 %
 * (palkkasumma enintään 2 509 500 €), työntekijä 0,89 %. TyEL-vakuuttamisen alaraja 71,72 €/kk.
 * Ennakonpidätys verokortin mukaan; ilman verokorttia 60 %.
 * Summat sentteinä, ellei toisin mainita.
 */

export type IncomeType = '201' | '210' | '215' | '308';
interface Insurance { tyel: boolean; unemployment: boolean; health: boolean; accident: boolean }

export const INCOME_TYPES: Record<IncomeType, { label: string; insurance: Insurance }> = {
  '201': { label: 'Aikapalkka', insurance: { tyel: true, unemployment: true, health: true, accident: true } },
  '210': { label: 'Kokouspalkkio', insurance: { tyel: false, unemployment: false, health: false, accident: false } },
  '215': { label: 'Luottamustoimipalkkio', insurance: { tyel: false, unemployment: false, health: true, accident: false } },
  '308': { label: 'Hallintoelimen jäsenyydestä maksettu palkkio', insurance: { tyel: false, unemployment: false, health: false, accident: false } },
};
export const isIncomeType = (x: unknown): x is IncomeType => typeof x === 'string' && x in INCOME_TYPES;

/** Prosentit. tyelTotal sisältää työntekijän osuuden. */
export interface PayrollRates {
  tyelTotal: number; tyelEmployee: number; unemploymentEmployer: number; unemploymentEmployee: number;
  healthEmployer: number; accident: number;
}
export const DEFAULT_RATES: PayrollRates = {
  tyelTotal: 25.85, tyelEmployee: 7.3, unemploymentEmployer: 0.31, unemploymentEmployee: 0.89, healthEmployer: 1.91, accident: 0,
};
export const RATES_YEAR = 2026;
export const NO_TAX_CARD_PERCENT = 60;
export const TYEL_MONTHLY_MIN = 7172; // senttiä
/** Ikärajat (ikä maksupäivänä): TyEL 17–67, työttömyysvakuutus 17–64, työnantajan sv-maksu 16–67. */
export const AGE_LIMITS = { tyel: [17, 67], unemployment: [17, 64], health: [16, 67] } as const;

export const PAYROLL_ACCOUNTS = {
  WAGES: '4010', SOCIAL: '4020', NET_PAYABLE: '2840', TAX_PAYABLE: '2850', INSURANCE_PAYABLE: '2855',
} as const;

const c = (eur: unknown) => Math.round(Number(eur ?? 0) * 100);
const pct = (cents: number, p: number) => Math.round((cents * p) / 100);

// ---------------------------------------------------------------- henkilötunnus

const HETU_CHECK = '0123456789ABCDEFHJKLMNPRSTUVWXY';
const CENTURY: Record<string, number> = {
  '+': 1800, '-': 1900, Y: 1900, X: 1900, W: 1900, V: 1900, U: 1900, A: 2000, B: 2000, C: 2000, D: 2000, E: 2000, F: 2000,
};

/** Henkilötunnus muodossa PPKKVV-NNNT (tarkiste ja päivämäärä). */
export const parseHetu = (raw: string): { birthDate: Date } | null => {
  const s = String(raw ?? '').trim().toUpperCase();
  const m = /^(\d{2})(\d{2})(\d{2})([-+A-FU-Y])(\d{3})([0-9A-Y])$/.exec(s);
  if (!m) return null;
  const [, dd, mm, yy, sep, nnn, check] = m;
  if (HETU_CHECK[Number(`${dd}${mm}${yy}${nnn}`) % 31] !== check) return null;
  const year = CENTURY[sep] + Number(yy);
  const birthDate = new Date(Date.UTC(year, Number(mm) - 1, Number(dd)));
  if (birthDate.getUTCMonth() !== Number(mm) - 1 || birthDate.getUTCDate() !== Number(dd)) return null;
  return { birthDate };
};
export const maskHetu = (h: string | null | undefined) => (h ? `${h.slice(0, 6)}${h[6] ?? ''}****` : null);

export const ageAt = (birth: Date, at: Date) => {
  let age = at.getUTCFullYear() - birth.getUTCFullYear();
  if (at.getUTCMonth() < birth.getUTCMonth() || (at.getUTCMonth() === birth.getUTCMonth() && at.getUTCDate() < birth.getUTCDate())) age--;
  return age;
};
const within = (age: number | null, [lo, hi]: readonly [number, number]) => age === null || (age >= lo && age <= hi);

// ---------------------------------------------------------------- ennakonpidätys

export interface TaxCard { percent: number | null; additionalPercent?: number | null; incomeLimit?: number | null }

/**
 * Ennakonpidätys verokortin mukaan. Tulorajaan asti perusprosentti, sen yli lisäprosentti.
 * ytdCents = saman vuoden aiemmin maksetut ennakonpidätyksen alaiset suoritukset. Pyöristys alaspäin sentteihin.
 */
export const withholding = (grossCents: number, card: TaxCard | null, ytdCents = 0): number => {
  if (!card || card.percent === null || card.percent === undefined) return Math.floor((grossCents * NO_TAX_CARD_PERCENT) / 100);
  const limit = card.incomeLimit ? c(card.incomeLimit) : null;
  if (limit === null || card.additionalPercent === null || card.additionalPercent === undefined) {
    return Math.floor((grossCents * card.percent) / 100);
  }
  const underLimit = Math.max(0, Math.min(grossCents, limit - ytdCents));
  const over = grossCents - underLimit;
  return Math.floor((underLimit * card.percent + over * card.additionalPercent) / 100);
};

// ---------------------------------------------------------------- palkkalaskelma

export interface PayItem { incomeType: IncomeType; amount: number; description?: string | null }
export interface PayeeInput { name: string; hetu?: string | null; taxCard: TaxCard | null }
export interface Payslip {
  gross: number; withholding: number; tyelEmployee: number; unemploymentEmployee: number; net: number;
  tyelEmployer: number; unemploymentEmployer: number; healthEmployer: number; accident: number;
  bases: { tyel: number; unemployment: number; health: number; accident: number };
  byType: Partial<Record<IncomeType, number>>;
  age: number | null; warnings: string[];
}

/**
 * Yhden palkansaajan laskelma maksupäivälle (senttiä). monthTyelBaseCents = saman kuukauden aiemmat TyEL-ansiot
 * (alarajan tarkistusta varten).
 */
export const computePayslip = (
  payee: PayeeInput, items: PayItem[], rates: PayrollRates, payDate: Date, ytdCents = 0, monthTyelBaseCents = 0,
): Payslip => {
  const warnings: string[] = [];
  const birth = payee.hetu ? parseHetu(payee.hetu)?.birthDate ?? null : null;
  const age = birth ? ageAt(birth, payDate) : null;
  if (!birth) warnings.push(`${payee.name}: henkilötunnus puuttuu tai on virheellinen. Tulorekisteri-ilmoitus vaatii sen.`);
  if (!payee.taxCard || payee.taxCard.percent === null || payee.taxCard.percent === undefined) {
    warnings.push(`${payee.name}: verokorttia ei ole annettu, ennakonpidätys ${NO_TAX_CARD_PERCENT} %.`);
  }
  const byType: Partial<Record<IncomeType, number>> = {};
  const bases = { tyel: 0, unemployment: 0, health: 0, accident: 0 };
  let gross = 0;
  for (const it of items) {
    const a = c(it.amount);
    gross += a;
    byType[it.incomeType] = (byType[it.incomeType] ?? 0) + a;
    const ins = INCOME_TYPES[it.incomeType].insurance;
    if (ins.tyel) bases.tyel += a;
    if (ins.unemployment) bases.unemployment += a;
    if (ins.health) bases.health += a;
    if (ins.accident) bases.accident += a;
  }
  if (!within(age, AGE_LIMITS.tyel) || (bases.tyel && bases.tyel + monthTyelBaseCents < TYEL_MONTHLY_MIN)) {
    if (bases.tyel && within(age, AGE_LIMITS.tyel)) warnings.push(`${payee.name}: TyEL-ansiot alle 71,72 €/kk, ei TyEL-maksua.`);
    bases.tyel = 0;
  }
  if (!within(age, AGE_LIMITS.unemployment)) bases.unemployment = 0;
  if (!within(age, AGE_LIMITS.health)) bases.health = 0;

  const wh = withholding(gross, payee.taxCard, ytdCents);
  const tyelEmployee = pct(bases.tyel, rates.tyelEmployee);
  const unemploymentEmployee = pct(bases.unemployment, rates.unemploymentEmployee);
  const tyelTotal = pct(bases.tyel, rates.tyelTotal);
  return {
    gross, withholding: wh, tyelEmployee, unemploymentEmployee, net: gross - wh - tyelEmployee - unemploymentEmployee,
    tyelEmployer: tyelTotal - tyelEmployee,
    unemploymentEmployer: pct(bases.unemployment, rates.unemploymentEmployer),
    healthEmployer: pct(bases.health, rates.healthEmployer),
    accident: pct(bases.accident, rates.accident),
    bases, byType, age, warnings,
  };
};

export const sumSlips = (slips: Payslip[]) => {
  const keys = ['gross', 'withholding', 'tyelEmployee', 'unemploymentEmployee', 'net', 'tyelEmployer', 'unemploymentEmployer', 'healthEmployer', 'accident'] as const;
  const t = Object.fromEntries(keys.map((k) => [k, slips.reduce((s, x) => s + x[k], 0)])) as Record<(typeof keys)[number], number>;
  return { ...t, employerCost: t.tyelEmployer + t.unemploymentEmployer + t.healthEmployer + t.accident };
};

/** Kirjanpitovienti (eurot): kulut 4010/4020, velat 2840 (nettopalkat), 2850 (Verohallinto), 2855 (vakuutusmaksut). */
export const payrollLines = (slips: Payslip[], description: string) => {
  const t = sumSlips(slips);
  const e = (cents: number) => cents / 100;
  const lines = [
    { accountNumber: PAYROLL_ACCOUNTS.WAGES, debit: e(t.gross), credit: 0, description },
    { accountNumber: PAYROLL_ACCOUNTS.SOCIAL, debit: e(t.employerCost), credit: 0, description: `${description}, sivukulut` },
    { accountNumber: PAYROLL_ACCOUNTS.NET_PAYABLE, debit: 0, credit: e(t.net), description: `${description}, nettopalkat` },
    { accountNumber: PAYROLL_ACCOUNTS.TAX_PAYABLE, debit: 0, credit: e(t.withholding + t.healthEmployer), description: `${description}, ennakonpidätys ja sv-maksu` },
    {
      accountNumber: PAYROLL_ACCOUNTS.INSURANCE_PAYABLE, debit: 0,
      credit: e(t.tyelEmployee + t.tyelEmployer + t.unemploymentEmployee + t.unemploymentEmployer + t.accident),
      description: `${description}, TyEL ja työttömyysvakuutus`,
    },
  ];
  return lines.filter((l) => l.debit || l.credit);
};

// ---------------------------------------------------------------- määräpäivät

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
/** Palkkatietoilmoitus tulorekisteriin: 5 kalenteripäivää maksupäivästä. */
export const wageReportDue = (payDate: Date) => utc(payDate.getUTCFullYear(), payDate.getUTCMonth(), payDate.getUTCDate() + 5);
/** Työnantajan erillisilmoitus: maksukuukautta seuraavan kuun 5. päivä. Maksu (ennakonpidätykset, sv-maksu): 12. päivä. */
export const employerReportDue = (year: number, month1: number) => utc(year, month1, 5);
export const employerPaymentDue = (year: number, month1: number) => utc(year, month1, 12);
/** Urakkatiedot: raportointikuukautta seuraavan toisen kuukauden 5. päivä (heinäkuu → 5.9.). */
export const contractReportDue = (year: number, month1: number) => utc(year, month1 + 1, 5);

// ---------------------------------------------------------------- rakentamisen urakkatiedot

export const CONTRACT_THRESHOLD = 1500000; // yli 15 000 € (alv 0) per sopimus

export interface ContractInput {
  id: string; contractorName: string; contractorBusinessId: string; value: number; startDate: Date; endDate: Date | null;
}
export interface InvoiceInput { supplierBusinessId: string | null; invoiceDate: Date; totalAmount: number; vatAmount: number | null }

/**
 * Kuukauden ilmoitettavat urakat: sopimuksen arvo yli 15 000 € ja kuukaudelle osuu laskutusta tai urakan alku.
 * Laskutettu määrä = urakoitsijan kuukauden ostolaskut (alv 0).
 */
export const contractsForMonth = (contracts: ContractInput[], invoices: InvoiceInput[], year: number, month1: number) => {
  const start = utc(year, month1 - 1, 1);
  const end = utc(year, month1, 1);
  const inMonth = (d: Date | null) => !!d && d >= start && d < end;
  return contracts
    .filter((k) => c(k.value) > CONTRACT_THRESHOLD)
    .map((k) => {
      const id = k.contractorBusinessId.trim();
      const inv = invoices.filter((i) => i.supplierBusinessId?.trim() === id && inMonth(i.invoiceDate));
      const invoiced = inv.reduce((s, i) => s + c(i.totalAmount) - c(i.vatAmount ?? 0), 0);
      return { ...k, invoiced: invoiced / 100, invoiceCount: inv.length, starts: inMonth(k.startDate), ends: inMonth(k.endDate) };
    })
    .filter((k) => k.invoiceCount > 0 || k.starts);
};
