import axios from 'axios';

const REPORTING_SERVICE_URL = import.meta.env.VITE_REPORTING_SERVICE_URL || 'http://localhost:3006/api/v1';

export const reportsApi = axios.create({
  baseURL: REPORTING_SERVICE_URL,
});

// Add auth interceptor to include JWT
reportsApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export type ReportKind = 'income-statement' | 'balance-sheet' | 'maintenance-calculation';

// fiscalYearId puuttuu => palvelu valitsee avoimen tilikauden
const params = (companyId: string, fiscalYearId?: string) => ({ companyId, ...(fiscalYearId ? { fiscalYearId } : {}) });

export const getIncomeStatement = async (companyId: string, fiscalYearId?: string) => {
  const { data } = await reportsApi.get('/reports/income-statement', { params: params(companyId, fiscalYearId) });
  return data;
};

export const getBalanceSheet = async (companyId: string, fiscalYearId?: string) => {
  const { data } = await reportsApi.get('/reports/balance-sheet', { params: params(companyId, fiscalYearId) });
  return data;
};

export const getMaintenanceCalculation = async (companyId: string, fiscalYearId?: string) => {
  const { data } = await reportsApi.get('/reports/maintenance-calculation', { params: params(companyId, fiscalYearId) });
  return data;
};

/** Avaa raportin PDF:nä uuteen välilehteen (tiedosto haetaan tunnisteella). */
export const openReportPdf = async (companyId: string, report: ReportKind, fiscalYearId?: string) => {
  const win = window.open('', '_blank'); // avataan heti, ettei selain estä ponnahdusikkunaa
  try {
    const { data } = await reportsApi.get('/reports/pdf', { params: { ...params(companyId, fiscalYearId), report }, responseType: 'blob' });
    const url = URL.createObjectURL(data);
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    win?.close();
    throw err;
  }
};
