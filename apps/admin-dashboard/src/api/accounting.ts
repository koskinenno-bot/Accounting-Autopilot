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

export const createEntry = async (entryData: any) => {
  const { data } = await accountingApi.post('/accounting/entries', entryData);
  return data;
};

export const getAccountingStats = async (companyId?: string) => {
  const url = companyId ? `/accounting/stats?companyId=${companyId}` : '/accounting/stats';
  const { data } = await accountingApi.get(url);
  return data;
};
