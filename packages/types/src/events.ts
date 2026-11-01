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
  };
}

export interface InvoiceStatusChangedEvent {
  id: string;
  timestamp: string;
  data: {
    invoiceId: string;
    companyId: string;
    status: 'DRAFT' | 'SENT' | 'PAID' | 'CANCELLED';
  };
}



