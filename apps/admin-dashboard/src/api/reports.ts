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

// --- Tilinpäätöspaketti (moduuli 7) ---

export interface PackageSection { key: string; title: string; text: string; auto: string; edited: boolean; needsInput: boolean }
export interface BalanceDetail {
  account: string; label: string; group: string; opening: number; debit: number; credit: number; closing: number;
  previous?: number; openingMismatch?: boolean; note: string;
}
export interface BudgetSection {
  title: string; total: number; previousTotal: number; subtotal?: boolean;
  rows: { account: string; label: string; amount: number; previous?: number }[];
}
export interface BudgetComparison {
  hasBudget: boolean; sections: BudgetSection[];
  summary: { title: string; actual: number; budget: number; difference: number }[];
}
export interface StoredPackage {
  report: Record<string, string>; notes: Record<string, string>; balanceNotes: Record<string, string>;
  signers: { name: string; role: string }[]; signPlace: string | null; signDate: string | null;
  auditorName: string | null; auditorKind: 'AUDITOR' | 'INSPECTOR' | null; signedAt: string | null; updatedAt: string | null;
}
export interface ClosingPackageView {
  company: { name: string; businessId: string | null; companyType: string };
  fiscalYear: any; previousFiscalYear: any | null; package: StoredPackage;
  report: PackageSection[]; notes: PackageSection[]; balanceDetails: BalanceDetail[];
  budget: BudgetComparison; netProfit: number; missing: string[];
}

export const getClosingPackage = async (companyId: string, fiscalYearId?: string) =>
  (await reportsApi.get('/reports/closing-package', { params: params(companyId, fiscalYearId) })).data as ClosingPackageView;

export const getBudgetComparison = async (companyId: string, fiscalYearId?: string) =>
  (await reportsApi.get('/reports/budget-comparison', { params: params(companyId, fiscalYearId) })).data as BudgetComparison;

export type BookPdf = 'closing-package' | 'balance-details' | 'journal' | 'general-ledger';

/** Tilinpäätöspaketin, tase-erittelyjen, päiväkirjan tai pääkirjan PDF uuteen välilehteen. */
export const openBookPdf = async (companyId: string, kind: BookPdf, fiscalYearId?: string) => {
  const win = window.open('', '_blank');
  try {
    const { data } = await reportsApi.get(`/reports/${kind}/pdf`, { params: params(companyId, fiscalYearId), responseType: 'blob' });
    const url = URL.createObjectURL(data);
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    win?.close();
    throw err;
  }
};
