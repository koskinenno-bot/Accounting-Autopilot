export interface CompanyCreatedEvent {
  id: string; // The message ID
  timestamp: string; // The time the message was created
  data: {
    companyId: string;
    businessId: string;
    name: string;
    fiscalYearStart: string; // Date string
    fiscalYearEnd: string; // Date string
    chartOfAccountsTemplate: string;
  };
}

export interface VoucherUploadedEvent {
  id: string;
  timestamp: string;
  data: {
    voucherId: string;
    companyId: string;
    s3Key: string;
    s3Bucket: string;
    filename: string;
    voucherType: string;
  };
}

/** ml-servicen /ml/extract-voucher -vastaus (Claude tai sääntöpohjainen varajäsennin). */
export interface VoucherExtraction {
  documentType: 'purchase_invoice' | 'receipt' | 'credit_note' | 'other';
  supplierName: string | null;
  supplierBusinessId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null; // YYYY-MM-DD
  dueDate: string | null;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  totalAmount: number | null;
  vatAmount: number | null;
  currency: string | null;
  referenceNumber: string | null;
  iban: string | null;
  lines: { description: string; amount: number | null }[];
  suggestedAccount: string;
  accountReason: string;
  confidence: number;
  extractor: 'claude' | 'heuristic';
}

export interface VoucherClassifiedEvent {
  id: string;
  timestamp: string;
  data: {
    voucherId: string;
    companyId: string;
    suggestedAccount: string;
    confidence: number;
    amount?: number;
    date?: string;
    supplier?: string;
    /** Tositteen luetut tiedot; puuttuu, jos luku epäonnistui. */
    extraction?: VoucherExtraction;
    /** Lukuvirhe käyttäjälle näytettäväksi. */
    error?: string;
  };
}

export interface BankStatementReceivedEvent {
  id: string;
  timestamp: string;
  data: {
    companyId: string;
    bankAccountId: string;
    transactions: BankTransaction[];
  };
}

export interface BankTransaction {
  bookingDate: string;
  amount: number;
  currency: string;
  creditDebit: 'CRDT' | 'DBIT';
  referenceNumber?: string;
  /** Saapuvassa maksussa maksaja, lähtevässä saaja. */
  counterpartyName?: string;
  payerName?: string;
  payerIban?: string;
  remittanceInfo?: string;
  entryReference?: string;
}

export interface InvoiceCreatedEvent {
  id: string;
  timestamp: string;
  data: {
    invoiceId: string;
    companyId: string;
    amount: number;
    referenceNumber: string;
    dueDate: string;
    /** Laskun päiväys = kirjauspäivä. Puuttuessa kirjataan käsittelypäivälle. */
    issueDate?: string;
    /**
     * Tulotilikohtainen erittely (esim. 3000 hoitovastike, 3900 rahoitusvastike, 3600 muistutusmaksu).
     * Puuttuessa koko summa kirjataan hoitovastikkeisiin.
     */
    lines?: { accountNumber: string; amount: number; description?: string; vatRate?: number; vatAmount?: number }[];
    /** Muistutettava huoneisto tai laskun kuvaus kirjanpidon selitteeseen. */
    description?: string;
  };
}

export interface InvoiceStatusChangedEvent {
  id: string;
  timestamp: string;
  data: {
    invoiceId: string;
    companyId: string;
    status: 'DRAFT' | 'SENT' | 'OVERDUE' | 'PAID' | 'CANCELLED';
  };
}



