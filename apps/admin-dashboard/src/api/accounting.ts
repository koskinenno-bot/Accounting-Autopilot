import axios from 'axios';

const ACCOUNTING_SERVICE_URL = import.meta.env.VITE_ACCOUNTING_SERVICE_URL || import.meta.env.VITE_API_URL || 'http://localhost:3002/api/v1';

export const accountingApi = axios.create({
  baseURL: ACCOUNTING_SERVICE_URL,
});

// Add auth interceptor to include JWT if needed (though accounting is often internal/protected)
accountingApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const getLedger = async (companyId: string) => {
  const { data } = await accountingApi.get(`/accounting/ledger?companyId=${companyId}`);
  return data;
};

/** Viennit tilan mukaan, esim. 'DRAFT' tai 'POSTED,LOCKED'. */
export const getLedgerByStatus = async (companyId: string, status: string) => {
  const { data } = await accountingApi.get('/accounting/ledger', { params: { companyId, status } });
  return data;
};

export const getAccounts = async (companyId: string) => {
  const { data } = await accountingApi.get('/accounting/accounts', { params: { companyId } });
  return data;
};

export interface Account {
  id: string;
  accountNumber: string;
  accountName: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  isActive: boolean;
}

/** Uusi tili tilikarttaan (vain isännöitsijä). Tilin tyyppi määräytyy numerosta. */
export const createAccount = async (body: { companyId: string; accountNumber: string; accountName: string }): Promise<Account> => {
  const { data } = await accountingApi.post('/accounting/accounts', body);
  return data;
};

/** Nimen muutos tai käytöstä poisto/palautus. Numeroa ei voi muuttaa. */
export const updateAccount = async (id: string, body: { accountName?: string; isActive?: boolean }): Promise<Account> => {
  const { data } = await accountingApi.patch(`/accounting/accounts/${id}`, body);
  return data;
};

export interface EntryLineInput {
  accountNumber: string;
  debit: number | string;
  credit: number | string;
  description?: string;
}

/** Luonnoksen rivien korvaus (vain DRAFT). */
export const updateEntryLines = async (id: string, lines: EntryLineInput[]) => {
  const { data } = await accountingApi.patch(`/accounting/entries/${id}`, { lines });
  return data;
};

/** acknowledgeMissingVoucher: tiliote riittää tositteeksi (esim. pankkikulut). */
export const postEntry = async (id: string, acknowledgeMissingVoucher = false) => {
  const { data } = await accountingApi.post(`/accounting/entries/${id}/post`, { acknowledgeMissingVoucher });
  return data;
};

/** "Hyväksy kaikki varmat": automaation varmoiksi merkitsemät luonnokset. */
export const postAutoApprovable = async (companyId: string): Promise<{ posted: number; skipped: { voucherNumber: string; reason: string }[] }> => {
  const { data } = await accountingApi.post('/accounting/entries/post-auto', { companyId });
  return data;
};

export const deleteEntry = async (id: string) => {
  await accountingApi.delete(`/accounting/entries/${id}`);
};

// --- Tilikaudet ja tilinpäätös ---

export const getFiscalYears = async (companyId: string) => {
  const { data } = await accountingApi.get('/accounting/fiscal-years', { params: { companyId } });
  return data;
};

export const getClosingChecklist = async (fiscalYearId: string) => {
  const { data } = await accountingApi.get(`/accounting/fiscal-years/${fiscalYearId}/closing-checklist`);
  return data;
};

export const closeFiscalYear = async (fiscalYearId: string, acknowledgeWarnings: boolean) => {
  const { data } = await accountingApi.post(`/accounting/fiscal-years/${fiscalYearId}/close`, { acknowledgeWarnings });
  return data;
};

export const setOpeningBalances = async (fiscalYearId: string, rows: { accountNumber: string; name?: string; balance: number }[]) => {
  const { data } = await accountingApi.post(`/accounting/fiscal-years/${fiscalYearId}/opening-balances`, { rows });
  return data;
};

export const getAssets = async (companyId: string) => {
  const { data } = await accountingApi.get('/accounting/assets', { params: { companyId } });
  return data;
};

export const createAsset = async (asset: Record<string, unknown>) => {
  const { data } = await accountingApi.post('/accounting/assets', asset);
  return data;
};

export const getDepreciation = async (fiscalYearId: string) => {
  const { data } = await accountingApi.get(`/accounting/fiscal-years/${fiscalYearId}/depreciation`);
  return data;
};

export const postDepreciation = async (fiscalYearId: string, items: { assetId: string; amount: number }[]) => {
  const { data } = await accountingApi.post(`/accounting/fiscal-years/${fiscalYearId}/depreciation`, { items });
  return data;
};

export const getAccruals = async (fiscalYearId: string) => {
  const { data } = await accountingApi.get(`/accounting/fiscal-years/${fiscalYearId}/accruals`);
  return data;
};

export const createAccrual = async (fiscalYearId: string, accrual: { kind: string; accountNumber: string; amount: number; description: string; voucherNumber?: string }) => {
  const { data } = await accountingApi.post(`/accounting/fiscal-years/${fiscalYearId}/accruals`, accrual);
  return data;
};

export const createEntry = async (entryData: any) => {
  const { data } = await accountingApi.post('/accounting/entries', entryData);
  return data;
};

export const getAccountingStats = async (companyId?: string) => {
  const url = companyId ? `/accounting/stats?companyId=${companyId}` : '/accounting/stats';
  const { data } = await accountingApi.get(url);
  return data;
};

export interface CompanyOverview {
  companyId: string;
  pending: number;
  needsVoucher: number;
  autoApprovable: number;
  overdueInvoices: number;
  lastBankDate: string | null;
  openFiscalYear: { id: string; startDate: string; endDate: string } | null;
  closingDue: boolean;
}

/** Kaikkien yhtiöiden tilanne isännöitsijän etusivulle. */
export const getOverview = async (companyIds: string[]): Promise<CompanyOverview[]> => {
  if (companyIds.length === 0) return [];
  const { data } = await accountingApi.get('/accounting/overview', { params: { companyIds: companyIds.join(',') } });
  return data;
};

export type QueueKind = 'CLOSING' | 'INVOICE' | 'REVIEW' | 'AUTO' | 'VOUCHER' | 'BANK';

export interface QueueItem {
  key: string;
  companyId: string;
  kind: QueueKind;
  priority: 1 | 2 | 3;
  title: string;
  detail?: string;
  date?: string;
  dueDate?: string;
  amount?: number;
  entryId?: string;
  count?: number;
  assignedTo: string | null;
  snoozedUntil: string | null;
  note: string | null;
}

/** Poikkeusjono: kaikkien yhtiöiden tehtävät, kiireellisin ensin. */
export const getQueue = async (companyIds: string[], includeSnoozed = false): Promise<QueueItem[]> => {
  if (companyIds.length === 0) return [];
  const { data } = await accountingApi.get('/accounting/queue', {
    params: { companyIds: companyIds.join(','), ...(includeSnoozed ? { includeSnoozed: 'true' } : {}) },
  });
  return data;
};

export const updateQueueTask = async (body: {
  companyId: string; itemKey: string; assignedTo?: string | null; snoozedUntil?: string | null; note?: string | null;
}) => (await accountingApi.put('/accounting/queue/task', body)).data;

// ---- Ostolaskujen hyväksyntä ja maksaminen (moduuli 5) ----

export interface PurchasePolicy { boardLimit: number | null; debtorIban: string | null; debtorBic: string | null }

export interface Purchase {
  id: string;
  supplierName: string;
  supplierBusinessId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  totalAmount: number;
  referenceNumber: string | null;
  iban: string | null;
  expenseAccount: string;
  status: 'PROPOSED' | 'BOOKED' | 'PAID';
  voucherId: string | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NOT_REQUIRED';
  waitingFor: string | null;
  needsBoard: boolean;
  approvals: { userId: string; role: string; decision: 'APPROVE' | 'REJECT'; comment: string | null; createdAt: string }[];
  myDecision: 'APPROVE' | 'REJECT' | null;
  paymentBatch: { id: string; executionDate: string; status: string } | null;
  paymentBlocker: string | null;
  duplicateOf: string | null;
}

export const getPurchases = async (companyId: string): Promise<{ policy: PurchasePolicy; myRole: string | null; invoices: Purchase[] }> =>
  (await accountingApi.get('/accounting/purchases', { params: { companyId } })).data;

export const decidePurchase = async (id: string, decision: 'APPROVE' | 'REJECT', comment?: string) =>
  (await accountingApi.post(`/accounting/purchases/${id}/decision`, { decision, comment })).data;

export const withdrawPurchaseDecision = async (id: string) =>
  (await accountingApi.delete(`/accounting/purchases/${id}/decision`)).data;

export const updatePurchaseDetails = async (id: string, body: { iban?: string; referenceNumber?: string; dueDate?: string }) =>
  (await accountingApi.patch(`/accounting/purchases/${id}`, body)).data;

export const updatePurchasePolicy = async (body: { companyId: string; boardLimit: number | null; debtorIban: string | null; debtorBic: string | null }) =>
  (await accountingApi.put('/accounting/purchases/policy', body)).data as PurchasePolicy;

export interface PaymentBatch {
  id: string;
  messageId: string;
  executionDate: string;
  debtorName: string;
  debtorIban: string;
  totalAmount: number;
  count: number;
  status: 'CREATED' | 'SENT' | 'CANCELLED';
  createdAt: string;
  sentAt: string | null;
  invoices: { id: string; supplierName: string; invoiceNumber: string | null; totalAmount: number; status: string }[];
}

export const getPaymentBatches = async (companyId: string): Promise<PaymentBatch[]> =>
  (await accountingApi.get('/accounting/payment-batches', { params: { companyId } })).data;

export const createPaymentBatch = async (body: { companyId: string; invoiceIds: string[]; executionDate: string; debtorName: string; debtorIban?: string; debtorBic?: string }) =>
  (await accountingApi.post('/accounting/payment-batches', body)).data as PaymentBatch;

export const updatePaymentBatch = async (id: string, status: 'SENT' | 'CANCELLED') =>
  (await accountingApi.patch(`/accounting/payment-batches/${id}`, { status })).data;

/** Lataa maksuaineiston XML-tiedostona (haetaan tunnisteella, siksi ei suoraa linkkiä). */
export const downloadPaymentBatch = async (batch: { id: string; executionDate: string; messageId: string }) => {
  const { data } = await accountingApi.get(`/accounting/payment-batches/${batch.id}/xml`, { responseType: 'blob' });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `maksut-${batch.executionDate.slice(0, 10)}-${batch.messageId}.xml`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
};

// --- Tilinpäätöspaketti ja talousarvio (moduuli 7) ---

export interface ClosingPackageUpdate {
  report?: Record<string, string>; notes?: Record<string, string>; balanceNotes?: Record<string, string>;
  signers?: { name: string; role: string }[]; signPlace?: string | null; signDate?: string | null;
  auditorName?: string | null; auditorKind?: 'AUDITOR' | 'INSPECTOR' | null; signed?: boolean;
}
export const updateClosingPackage = async (fiscalYearId: string, body: ClosingPackageUpdate) =>
  (await accountingApi.put(`/accounting/fiscal-years/${fiscalYearId}/closing-package`, body)).data;

export interface BudgetData {
  fiscalYear: any; previousFiscalYear: any | null;
  lines: { accountNumber: string; amount: number }[];
  accounts: { accountNumber: string; accountName: string; isActive: boolean }[];
  actual: Record<string, number>; previous: Record<string, number>;
}
export const getBudget = async (fiscalYearId: string) =>
  (await accountingApi.get(`/accounting/fiscal-years/${fiscalYearId}/budget`)).data as BudgetData;
export const saveBudget = async (fiscalYearId: string, lines: { accountNumber: string; amount: number }[]) =>
  (await accountingApi.put(`/accounting/fiscal-years/${fiscalYearId}/budget`, { lines })).data as { saved: number };

// --- Siirto vanhasta järjestelmästä (moduuli 11) ---

export type SignMode = 'DEBIT_POSITIVE' | 'NATURAL';
export interface MigrationRow {
  line: number; sourceAccount: string; sourceName: string; amount: number;
  targetAccount: string | null; targetName: string | null; how: 'saved' | 'number' | 'name' | null;
}
export interface MigrationDone { fiscalYearId: string; voucherNumber: string; createdAt: string; startDate: string | null; endDate: string | null; accounts: number }
export interface MigrationPreview {
  rows: MigrationRow[]; errors: string[]; warnings: string[];
  totals: { debit: number; credit: number; difference: number; result: number };
  accounts: { accountNumber: string; accountName: string; isActive: boolean }[];
  suggestedPeriod: { startDate: string; endDate: string } | null;
  migrated: MigrationDone[];
}
export const getMigrations = async (companyId: string) =>
  (await accountingApi.get('/accounting/migration', { params: { companyId } })).data as { migrated: MigrationDone[]; mappings: number };
export const previewMigration = async (companyId: string, text: string, signMode: SignMode) =>
  (await accountingApi.post('/accounting/migration/preview', { companyId, text, signMode })).data as MigrationPreview;
export const importMigration = async (body: {
  companyId: string; text: string; signMode: SignMode; mapping: Record<string, string>; startDate: string; endDate: string; createOpening: boolean;
}) => (await accountingApi.post('/accounting/migration/import', body)).data as { lines: number; result: number; mappings: number; openingEntryId: string | null };
export interface OpenPayableRow { line: number; supplierName: string; invoiceNumber: string | null; amount: number; dueDate: string | null; referenceNumber: string | null; iban: string | null }
export interface OpenPayablesPreview { items: OpenPayableRow[]; total: number; openingPayables: number; alreadyImported: number; errors: string[]; warnings: string[] }
export const previewOpenPayables = async (companyId: string, text: string) =>
  (await accountingApi.post('/accounting/migration/payables/preview', { companyId, text })).data as OpenPayablesPreview;
export const importOpenPayables = async (companyId: string, text: string) =>
  (await accountingApi.post('/accounting/migration/payables', { companyId, text })).data as { created: number; total: number };
export const undoMigration = async (fiscalYearId: string) =>
  (await accountingApi.delete(`/accounting/migration/${fiscalYearId}`)).data;

// --- Arvonlisävero (moduuli 8) ---
export interface VatSettings {
  companyId: string; registered: boolean; period: 'MONTH' | 'QUARTER' | 'YEAR'; deductionPercent: number;
  registeredFrom: string | null; businessId: string | null; contactPhone: string | null;
}
export interface VatPeriodRow {
  key: string; label: string; start: string; end: string; due: string; ended: boolean;
  payable: number; output: number; deductible: number; settled: boolean; warnings: number;
}
export interface VatReturn {
  period: { key: string; label: string; start: string; end: string; due: string; length: string };
  fields: { code: string; label: string; amount: number }[];
  payable: number; warnings: string[];
  settlement: { id: string; entryDate: string; status: string } | null;
  preview: { accountNumber: string; debit: number; credit: number; description?: string }[];
}
export const getVatSettings = async (companyId: string) =>
  (await accountingApi.get('/accounting/vat/settings', { params: { companyId } })).data as { settings: VatSettings; softwareFileEnabled: boolean };
export const saveVatSettings = async (body: Partial<VatSettings> & { companyId: string }) =>
  (await accountingApi.put('/accounting/vat/settings', body)).data as { settings: VatSettings };
export const getVatPeriods = async (companyId: string, year: number) =>
  (await accountingApi.get('/accounting/vat/periods', { params: { companyId, year } })).data as { year: number; periods: VatPeriodRow[] };
export const getVatReturn = async (companyId: string, period: string) =>
  (await accountingApi.get('/accounting/vat/return', { params: { companyId, period } })).data as VatReturn;
export const settleVat = async (companyId: string, period: string) =>
  (await accountingApi.post('/accounting/vat/settle', { companyId, period })).data as { payable: number };
export const downloadVatFile = async (companyId: string, period: string) => {
  const res = await accountingApi.get('/accounting/vat/return/file', { params: { companyId, period }, responseType: 'blob' });
  const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] || '')?.[1] || `ALV_${period}.txt`;
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
};

// --- Veroilmoitus 4 (moduuli 8) ---

export interface TaxReturnRow { key: string; label: string; kind: 'income' | 'expense'; books: number; tax: number; accounts: string[]; note?: string }
export interface TaxReturnView {
  fiscalYear: { id: string; startDate: string; endDate: string; status: string };
  rows: TaxReturnRow[];
  totals: { booksIncome: number; booksExpense: number; booksResult: number; taxIncome: number; taxExpense: number; taxableIncome: number; confirmedLoss: number };
  warnings: string[];
  dueHint: string;
}
export const getTaxReturn = async (fiscalYearId: string): Promise<TaxReturnView> =>
  (await accountingApi.get(`/accounting/fiscal-years/${fiscalYearId}/tax-return`)).data;

// --- Pankkitäsmäytys ---

export interface ReconMonth {
  key: string; date: string; current: boolean; bank: number; book: number; status: 'OK' | 'DIFFERENCE' | 'NO_BALANCE' | 'STALE';
  difference: number | null; drafts: { count: number; net: number }; reconciledAt: string | null;
  accounts: { iban: string; date: string; balance: number; source: string; stale: boolean }[];
}
export interface ReconView {
  year: number; range: [string, string]; months: ReconMonth[];
  balances: { id: string; iban: string; date: string; balance: number; source: string }[];
}
export const getBankReconciliation = async (companyId: string, year: number): Promise<ReconView> =>
  (await accountingApi.get('/accounting/bank-reconciliation', { params: { companyId, year } })).data;
export const saveBankBalance = async (companyId: string, iban: string, date: string, balance: number) =>
  (await accountingApi.post('/accounting/bank-balances', { companyId, iban, date, balance, source: 'MANUAL' })).data;
export const deleteBankBalance = async (id: string) => (await accountingApi.delete(`/accounting/bank-balances/${id}`)).data;
export const markBankReconciled = async (companyId: string, key: string, reconciled: boolean) =>
  (await accountingApi.post('/accounting/bank-reconciliation/mark', { companyId, key, reconciled })).data;

// --- Ajankäyttö yhtiöittäin ---
export interface CompanyTime {
  companyId: string;
  minutesYear: number;
  minutesMonth: number;
  projectedYearHours: number | null;
  targetHours: number;
  status: 'ok' | 'warning' | 'over';
}
export interface TimeEntry { id: string; companyId: string; userId: string; day: string; minutes: number; note: string | null }

export const sendTimeHeartbeat = async (companyId: string) => {
  await accountingApi.post('/accounting/time/heartbeat', { companyId });
};
export const getTimeSummary = async (companyIds: string[]): Promise<CompanyTime[]> => {
  if (companyIds.length === 0) return [];
  const { data } = await accountingApi.get('/accounting/time/summary', { params: { companyIds: companyIds.join(',') } });
  return data;
};
export const getTimeEntries = async (companyId: string): Promise<{ entries: TimeEntry[]; autoByUser: { userId: string; minutes: number }[] }> => {
  const { data } = await accountingApi.get('/accounting/time/entries', { params: { companyId } });
  return data;
};
export const createTimeEntry = async (body: { companyId: string; day: string; minutes: number; note?: string }) => {
  const { data } = await accountingApi.post('/accounting/time/entries', body);
  return data;
};
export const deleteTimeEntry = async (id: string) => {
  await accountingApi.delete(`/accounting/time/entries/${id}`);
};

// --- Puuttuvat tositteet ---
export interface MissingVoucher {
  id: string; entryDate: string; amount: number; counterparty: string | null; description: string | null;
  voucherRequestedAt: string | null; voucherRequestedFrom: string | null;
}
export const getMissingVouchers = async (companyId: string): Promise<MissingVoucher[]> => {
  const { data } = await accountingApi.get('/accounting/missing-vouchers', { params: { companyId } });
  return data;
};
export const requestMissingVouchers = async (body: { companyId: string; recipient: string; replyTo?: string; message?: string }) => {
  const { data } = await accountingApi.post('/accounting/missing-vouchers/request', body);
  return data as { requested: number };
};
