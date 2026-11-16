import { XMLParser } from 'fast-xml-parser';

export interface BankTransaction {
  bookingDate: string;
  amount: number;
  currency: string;
  creditDebit: 'CRDT' | 'DBIT';
  referenceNumber?: string;
  /** Vastapuoli: saapuvassa maksussa maksaja (Dbtr), lähtevässä saaja (Cdtr). */
  counterpartyName?: string;
  /** Yhteensopivuus: sama kuin counterpartyName. */
  payerName?: string;
  payerIban?: string;
  remittanceInfo?: string;
  entryReference?: string;
}

/** Kotimainen viitenumero (4–20 numeroa, tarkiste 7-3-1). */
export const isValidFinnishReference = (s: string): boolean => {
  const d = String(s).replace(/\s/g, '');
  if (!/^\d{4,20}$/.test(d) || /^0+$/.test(d)) return false;
  const body = d.slice(0, -1);
  const w = [7, 3, 1];
  const sum = body.split('').reverse().reduce((t, c, i) => t + Number(c) * w[i % 3], 0);
  return (10 - (sum % 10)) % 10 === Number(d.slice(-1));
};

export const parseCamt053 = (xmlData: string): BankTransaction[] => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    // Viitenumerot (jopa 20 numeroa) ja NtryRef pidetään merkkijonoina: numeroksi
    // muunnettuna pitkä viite menettäisi tarkkuutta eikä täsmäisi laskuun.
    parseTagValue: false,
  });
  
  const jsonObj = parser.parse(xmlData);
  const stmt = jsonObj.Document?.BkToCstmrStmt?.Stmt;
  const entries = Array.isArray(stmt?.Ntry) ? stmt.Ntry : [stmt?.Ntry].filter(Boolean);
  
  return entries.map((entry: any) => {
    const tx = entry.NtryDtls?.TxDtls;
    const creditDebit: 'CRDT' | 'DBIT' = entry.CdtDbtInd;
    // Ustrd voi esiintyä useasti => parseri palauttaa taulukon
    const rawUstrd = tx?.RmtInf?.Ustrd;
    const remittanceInfo = Array.isArray(rawUstrd)
      ? rawUstrd.map(String).join(' ')
      : rawUstrd !== undefined ? String(rawUstrd) : undefined;

    // Extract Finnish Reference Number (viitenumero) from Remittance Info
    // Usually found in RmtInf -> Strd -> CdtrRefInf -> Ref
    let reference = tx?.RmtInf?.Strd?.CdtrRefInf?.Ref;
    if (reference !== undefined) reference = String(reference);

    // Fallback: viite vapaamuotoisesta viestistä vain saapuville maksuille
    // (lähtevän maksun viesti on laskun viite toiselle yritykselle, ei meidän saatava).
    // Vain tarkisteeltaan kelvollinen viite kelpaa: aiemmin mikä tahansa 4–20 numeron jono (esim. vuosiluku
    // viestissä "Vastike B 9 03/2025") tulkittiin viitteeksi, jolloin suoritus ei mennyt selvitettäviin.
    if (!reference && creditDebit === 'CRDT' && remittanceInfo) {
      reference = (remittanceInfo.match(/\b\d{4,20}\b/g) || []).find(isValidFinnishReference);
    }

    // Saapuvassa maksussa vastapuoli on maksaja (Dbtr), lähtevässä saaja (Cdtr)
    const party = creditDebit === 'CRDT' ? 'Dbtr' : 'Cdtr';
    const counterpartyName = tx?.RltdPties?.[party]?.Nm;

    return {
      bookingDate: entry.BookgDt?.Dt || entry.BookgDt?.DtTm,
      amount: parseFloat(entry.Amt?.['#text'] || entry.Amt || '0'),
      currency: entry.Amt?.['@_Ccy'] || 'EUR',
      creditDebit,
      referenceNumber: reference,
      counterpartyName,
      payerName: counterpartyName,
      payerIban: tx?.RltdPties?.[`${party}Acct`]?.Id?.IBAN,
      remittanceInfo,
      entryReference: entry.NtryRef !== undefined ? String(entry.NtryRef) : undefined,
    };
  });
};

/** Tiliotteen loppusaldo (CLBD) ja tilin IBAN. Palauttaa null, jos tiliotteella ei ole loppusaldoa. */
export const parseCamtClosingBalance = (xmlData: string): { iban: string; date: string; amount: number } | null => {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });
  const stmt = parser.parse(xmlData).Document?.BkToCstmrStmt?.Stmt;
  const s = Array.isArray(stmt) ? stmt[0] : stmt;
  const iban = s?.Acct?.Id?.IBAN;
  const bals = Array.isArray(s?.Bal) ? s.Bal : [s?.Bal].filter(Boolean);
  const clbd = bals.find((b: any) => (b?.Tp?.CdOrPrtry?.Cd ?? b?.Tp?.CdOrPrtry?.Prtry) === 'CLBD');
  if (!iban || !clbd) return null;
  const raw = Number(clbd.Amt?.['#text'] ?? clbd.Amt);
  if (!Number.isFinite(raw)) return null;
  const amount = clbd.CdtDbtInd === 'DBIT' ? -raw : raw;
  const date = String(clbd.Dt?.Dt ?? clbd.Dt?.DtTm ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { iban: String(iban).replace(/\s/g, ''), date, amount };
};
