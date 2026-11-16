/**
 * Ostolaskujen puhtaat apufunktiot (testattavissa ilman tietokantaa):
 * toimittaja-avain, automaattihyväksynnän arvio ja pankkimenon täsmäytys ostolaskuun.
 */
import { ACCOUNTS } from './accounts';

/** Automaattisesti hyväksyttäväksi merkitsemisen raja (tekoälyn varmuus). */
export const AUTO_APPROVE_CONFIDENCE = 0.8;
/** Pankkimaksun päivän sallittu ero laskun eräpäivästä (sääntö 2). */
export const DUE_DATE_TOLERANCE_DAYS = 14;

/** Toimittajan tunniste: Y-tunnus tai nimi ilman yhtiömuotoja ja välimerkkejä. */
export const supplierKey = (name: string | null | undefined, businessId?: string | null): string => {
  if (businessId && /^\d{7}-\d$/.test(businessId.trim())) return businessId.trim();
  return normalizeName(name);
};

export const normalizeName = (name: string | null | undefined): string =>
  (name || '')
    .toLowerCase()
    .replace(/\b(oy|oyj|ab|ky|tmi|ltd|ry|osk)\b/g, ' ')
    .replace(/[^a-z0-9åäö]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

/** Nimet vastaavat, jos toinen sisältää toisen normalisoituna (esim. "HSY" ~ "HSY Jätehuolto"). */
export const similarNames = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
};

/** Viitenumero vertailumuotoon: ei välilyöntejä, ei etunollia (RF-viite säilyy sellaisenaan). */
export const normalizeReference = (ref: string | null | undefined): string => {
  const compact = (ref || '').replace(/\s+/g, '').toUpperCase();
  return compact.startsWith('RF') ? compact : compact.replace(/^0+/, '');
};

export interface ExtractionLike {
  supplierName: string | null;
  invoiceDate: string | null;
  totalAmount: number | null;
  dueDate: string | null;
  confidence: number;
  extractor: string;
}

/**
 * Voiko tekoälyn luoman luonnoksen merkitä "varmaksi"? Hyväksyntä tehdään silti aina ihmisen
 * napin painalluksella. Palauttaa myös syyt, jotka näytetään käsittelijälle.
 */
export const assessAutoApproval = (
  x: ExtractionLike,
  account: string,
  opts: { trustedSupplier?: boolean } = {},
): { autoApprovable: boolean; issues: string[] } => {
  const issues: string[] = [];
  if (!x.supplierName) issues.push('toimittaja puuttuu');
  if (!x.invoiceDate) issues.push('laskun päivä puuttuu');
  if (!x.dueDate) issues.push('eräpäivä puuttuu');
  if (!(Number(x.totalAmount) > 0)) issues.push('summa puuttuu');
  if (account === ACCOUNTS.SUSPENSE) issues.push('tiliä ei tunnistettu');
  // Tuttu toimittaja (ks. isTrustedSupplier): sääntöpohjainen luku riittää, kun kaikki kentät löytyivät
  if (!opts.trustedSupplier) {
    if (x.extractor !== 'claude') issues.push('luettu ilman tekoälyä, tarkista tiedot');
    if (x.confidence < AUTO_APPROVE_CONFIDENCE) issues.push(`varmuus ${Math.round(x.confidence * 100)} %`);
  }
  return { autoApprovable: issues.length === 0, issues };
};

/**
 * Tutun toimittajan raja: näin monta aiempaa hyväksyttyä laskua samalla tilillä ja tilinumerolla. Uuden toimittajan
 * ensimmäinen lasku tarkistetaan aina käsin; sen jälkeen toinen samanlainen lasku on varma (aiemmin raja oli 2).
 */
export const TRUSTED_SUPPLIER_MIN_INVOICES = 1;

/**
 * Toistuva toimittaja (kaukolämpö, isännöinti, siivous): aiempi käsin hyväksytty lasku
 * samalle kulutilille, sama saajan tilinumero kuin aiemmin, ja summa enintään 2-kertainen aiempien
 * suurimpaan verrattuna. Silloin luonnos on "varma" myös ilman tekoälyä. Uusi tilinumero, uusi tili tai
 * poikkeuksellisen suuri summa vaatii aina ihmisen tarkistuksen (laskupetosten torjunta).
 */
export const isTrustedSupplier = (
  previous: { expenseAccount: string; iban: string | null; totalAmount: number }[],
  account: string,
  iban: string | null | undefined,
  amount: number,
): boolean => {
  const norm = (s: string | null | undefined) => String(s ?? '').replace(/\s/g, '').toUpperCase();
  if (!iban || previous.length < TRUSTED_SUPPLIER_MIN_INVOICES) return false;
  if (!previous.every((p) => p.expenseAccount === account && norm(p.iban) === norm(iban))) return false;
  const max = Math.max(...previous.map((p) => Number(p.totalAmount)));
  return amount <= max * 2;
};

export interface OpenInvoiceLike {
  id: string;
  supplierName: string;
  totalAmount: number;
  dueDate: Date | null;
  referenceNumber: string | null;
  iban: string | null;
}

export interface OutgoingPaymentLike {
  amount: number;
  bookingDate: string;
  referenceNumber?: string;
  counterpartyName?: string;
  counterpartyIban?: string;
}

const sameAmount = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);
const daysBetween = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 86_400_000;

/**
 * Pankin lähtevä maksu -> avoin ostolasku. Järjestys:
 *  1. viitenumero (ja sama summa),
 *  2. summa + (IBAN tai toimittajan nimi) ja maksupäivä ±14 pv eräpäivästä,
 *  3. summa yksikäsitteisesti (vain yksi avoin lasku tällä summalla).
 * Palauttaa laskun ja säännön numeron, tai null.
 */
export const matchPurchaseInvoice = <T extends OpenInvoiceLike>(
  tx: OutgoingPaymentLike,
  open: T[],
): { invoice: T; rule: 1 | 2 | 3 } | null => {
  const amountMatches = open.filter((inv) => sameAmount(Number(inv.totalAmount), tx.amount));
  if (amountMatches.length === 0) return null;

  const ref = normalizeReference(tx.referenceNumber);
  if (ref) {
    const byRef = amountMatches.find((inv) => normalizeReference(inv.referenceNumber) === ref);
    if (byRef) return { invoice: byRef, rule: 1 };
  }

  const paid = new Date(tx.bookingDate);
  const byParty = amountMatches.filter((inv) => {
    const partyOk = (tx.counterpartyIban && inv.iban && tx.counterpartyIban.replace(/\s/g, '') === inv.iban.replace(/\s/g, ''))
      || similarNames(tx.counterpartyName, inv.supplierName);
    const dateOk = !inv.dueDate || daysBetween(paid, inv.dueDate) <= DUE_DATE_TOLERANCE_DAYS;
    return partyOk && dateOk;
  });
  if (byParty.length === 1) return { invoice: byParty[0], rule: 2 };

  if (amountMatches.length === 1 && byParty.length === 0) return { invoice: amountMatches[0], rule: 3 };
  return null;
};
