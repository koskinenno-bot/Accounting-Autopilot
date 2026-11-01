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
    if (!reference && creditDebit === 'CRDT' && remittanceInfo) {
      const match = remittanceInfo.match(/[0-9]{4,20}/); // Simple regex for potential ref
      if (match) reference = match[0];
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
