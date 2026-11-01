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

export const createEntry = async (entryData: any) => {
  const { data } = await accountingApi.post('/accounting/entries', entryData);
  return data;
};

export const getAccountingStats = async (companyId?: string) => {
  const url = companyId ? `/accounting/stats?companyId=${companyId}` : '/accounting/stats';
  const { data } = await accountingApi.get(url);
  return data;
};
