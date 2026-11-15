/**
 * Tilinpäätöksen arkistointi (KPL 2:10 §).
 *
 * Tilinpäätös, tase-erittelyt, päiväkirja ja pääkirja säilytetään vähintään 10 vuotta tilikauden
 * päättymisestä. Kun tilinpäätös merkitään allekirjoitetuksi, sen PDF:t tallennetaan arkistoon
 * lukittuina: arkistoitua dokumenttia ei voi poistaa eikä korvata, ja sen SHA-256-tiiviste tallennetaan.
 */
export const RETENTION_YEARS = 10;

export interface ArchiveItem { key: string; path: string; name: string; filename: string }

/** Arkistoitavat aineistot ja reporting-servicen PDF-polut. */
export const closingArchiveItems = (fiscalYearId: string, year: string): ArchiveItem[] => [
  { key: `closing:${fiscalYearId}:package`, path: '/reports/closing-package/pdf', name: `Tilinpäätös ${year}`, filename: `tilinpaatos-${year}.pdf` },
  { key: `closing:${fiscalYearId}:balance-details`, path: '/reports/balance-details/pdf', name: `Tase-erittelyt ${year}`, filename: `tase-erittelyt-${year}.pdf` },
  { key: `closing:${fiscalYearId}:journal`, path: '/reports/journal/pdf', name: `Päiväkirja ${year}`, filename: `paivakirja-${year}.pdf` },
  { key: `closing:${fiscalYearId}:general-ledger`, path: '/reports/general-ledger/pdf', name: `Pääkirja ${year}`, filename: `paakirja-${year}.pdf` },
];

/** Säilytys päättyy 10 vuotta tilikauden päättymisen jälkeen (vuoden loppuun asti varmuuden vuoksi). */
export const retentionUntil = (fiscalYearEnd: Date): Date =>
  new Date(Date.UTC(fiscalYearEnd.getUTCFullYear() + RETENTION_YEARS, 11, 31));

/** Onko tiedosto PDF (alkaa %PDF-). */
export const looksLikePdf = (buf: Buffer): boolean => buf.length > 4 && buf.subarray(0, 5).toString('latin1') === '%PDF-';
