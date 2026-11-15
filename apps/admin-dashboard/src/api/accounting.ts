import axios from 'axios';

const ACCOUNTING_SERVICE_URL = import.meta.env.VITE_ACCOUNTING_SERVICE_URL || 'http://localhost:3002/api/v1';

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
