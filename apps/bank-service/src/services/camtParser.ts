import { XMLParser } from 'fast-xml-parser';

export interface BankTransaction {
  bookingDate: string;
  amount: number;
  currency: string;
  creditDebit: 'CRDT' | 'DBIT';
  referenceNumber?: string;
  payerName?: string;
  payerIban?: string;
  remittanceInfo?: string;
  entryReference?: string;
}

export const parseCamt053 = (xmlData: string): BankTransaction[] => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
  });
  
  const jsonObj = parser.parse(xmlData);
  const stmt = jsonObj.Document?.BkToCstmrStmt?.Stmt;
  const entries = Array.isArray(stmt?.Ntry) ? stmt.Ntry : [stmt?.Ntry].filter(Boolean);
  
  return entries.map((entry: any) => {
    // Extract Finnish Reference Number (viitenumero) from Remittance Info
    // Usually found in RmtInf -> Strd -> CdtrRefInf -> Ref
    let reference = entry.NtryDtls?.TxDtls?.RmtInf?.Strd?.CdtrRefInf?.Ref;
    
    // Fallback: try to find it in unstructured info if not in structured
    if (!reference) {
      const ustrd = entry.NtryDtls?.TxDtls?.RmtInf?.Ustrd;
      if (typeof ustrd === 'string') {
        const match = ustrd.match(/[0-9]{4,20}/); // Simple regex for potential ref
        if (match) reference = match[0];
      }
    }

    return {
      bookingDate: entry.BookgDt?.Dt || entry.BookgDt?.DtTm,
      amount: parseFloat(entry.Amt?.['#text'] || entry.Amt || '0'),
      currency: entry.Amt?.['@_Ccy'] || 'EUR',
      creditDebit: entry.CdtDbtInd,
      referenceNumber: reference,
      payerName: entry.NtryDtls?.TxDtls?.RltdPties?.Dbtr?.Nm,
      payerIban: entry.NtryDtls?.TxDtls?.RltdPties?.DbtrAcct?.Id?.IBAN,
      remittanceInfo: entry.NtryDtls?.TxDtls?.RmtInf?.Ustrd,
      entryReference: entry.NtryRef,
    };
  });
};
