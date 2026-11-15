import { accountingApi } from './accounting';

// --- Palkat, tulorekisteri ja urakkatiedot (moduuli 9) ---

export type IncomeType = '201' | '210' | '215' | '308';
export interface Rates {
  tyelTotal: number; tyelEmployee: number; unemploymentEmployer: number; unemploymentEmployee: number; healthEmployer: number; accident: number;
}
export interface PayrollSettingsView {
  settings: { rates: Rates; tyelInsurer: string | null; tyelPolicy: string | null; saved: boolean };
  defaults: Rates; ratesYear: number; noTaxCardPercent: number;
  incomeTypes: { code: IncomeType; label: string; insurance: { tyel: boolean; unemployment: boolean; health: boolean; accident: boolean } }[];
}
export interface Payee {
  id: string; name: string; hetu: string | null; hasHetu: boolean; iban: string | null; role: string | null;
  taxPercent: number | null; taxAdditionalPercent: number | null; taxIncomeLimit: number | null; taxCardYear: number | null;
  defaultIncomeType: IncomeType; defaultAmount: number | null; isActive: boolean;
}
export interface Totals {
  gross: number; withholding: number; tyelEmployee: number; unemploymentEmployee: number; net: number;
  tyelEmployer: number; unemploymentEmployer: number; healthEmployer: number; accident: number; employerCost: number;
}
export interface RunSummary {
  id: string; number: number; payDate: string; periodStart: string; periodEnd: string; description: string;
  status: 'DRAFT' | 'POSTED'; accountingEntryId: string | null; wageReportedAt: string | null; wageReportDue: string;
  totals: Totals | null; payees: number;
}
export interface Slip extends Omit<Totals, 'employerCost'> {
  payeeId: string; name: string; hetu: string | null; age: number | null;
  byType: Partial<Record<IncomeType, number>>; items: { incomeType: IncomeType; amount: number; description?: string | null }[];
}
export interface RunDetail {
  run: RunSummary; items: { id: string; payeeId: string; incomeType: IncomeType; amount: number; description: string | null }[];
  slips: Slip[]; totals: Totals; warnings: string[];
  lines: { accountNumber: string; debit: number; credit: number; description: string }[];
}
export interface RunInput {
  companyId: string; payDate: string; periodStart: string; periodEnd: string; description: string;
  items: { payeeId: string; incomeType: IncomeType; amount: number; description?: string }[];
}
export interface MonthReport {
  key: string; wages: number; healthBase: number; healthEmployer: number; withholding: number; payable: number; tyel: number;
  unemployment: number; reportDue: string; paymentDue: string; reportedAt: string | null;
}
export interface WageReport extends RunSummary {
  slips: {
    name: string; hetu: string | null; byType: Record<string, number>; withholding: number; tyelEmployee: number; unemploymentEmployee: number;
    insured: { tyel: boolean; unemployment: boolean; health: boolean; accident: boolean };
  }[];
}
export interface Contract {
  id: string; contractorName: string; contractorBusinessId: string; siteName: string; siteAddress: string | null;
  description: string | null; value: number; billingBasis: 'URAKKA' | 'TUNTI'; startDate: string; endDate: string | null;
}
export interface ContractReport {
  month: string; due: string; reportedAt: string | null;
  rows: (Contract & { invoiced: number; invoiceCount: number; starts: boolean; ends: boolean })[];
}

const base = '/accounting/payroll';
export const getPayrollSettings = async (companyId: string): Promise<PayrollSettingsView> =>
  (await accountingApi.get(`${base}/settings`, { params: { companyId } })).data;
export const savePayrollSettings = async (body: Rates & { companyId: string; tyelInsurer: string | null; tyelPolicy: string | null }) =>
  (await accountingApi.put(`${base}/settings`, body)).data;

export const getPayees = async (companyId: string): Promise<Payee[]> =>
  (await accountingApi.get(`${base}/payees`, { params: { companyId } })).data.payees;
export const savePayee = async (companyId: string, id: string | null, body: Record<string, unknown>) =>
  id ? (await accountingApi.patch(`${base}/payees/${id}`, body)).data : (await accountingApi.post(`${base}/payees`, { companyId, ...body })).data;

export const getRuns = async (companyId: string, year: number): Promise<RunSummary[]> =>
  (await accountingApi.get(`${base}/runs`, { params: { companyId, year } })).data.runs;
export const getRun = async (id: string): Promise<RunDetail> => (await accountingApi.get(`${base}/runs/${id}`)).data;
export const saveRun = async (id: string | null, body: RunInput) =>
  id ? (await accountingApi.put(`${base}/runs/${id}`, body)).data : (await accountingApi.post(`${base}/runs`, body)).data;
export const deleteRun = async (id: string) => (await accountingApi.delete(`${base}/runs/${id}`)).data;
export const postRun = async (id: string) => (await accountingApi.post(`${base}/runs/${id}/post`)).data;
export const markRunReported = async (id: string, reported: boolean) =>
  (await accountingApi.post(`${base}/runs/${id}/reported`, { reported })).data;

export const getPayrollReports = async (companyId: string, year: number): Promise<{ months: MonthReport[]; wageReports: WageReport[]; settings: PayrollSettingsView['settings'] }> =>
  (await accountingApi.get(`${base}/reports`, { params: { companyId, year } })).data;
export const markReport = async (companyId: string, kind: 'EMPLOYER' | 'CONTRACTS', key: string, reported: boolean) =>
  (await accountingApi.post(`${base}/reports/mark`, { companyId, kind, key, reported })).data;

export const getContracts = async (companyId: string): Promise<Contract[]> =>
  (await accountingApi.get(`${base}/contracts`, { params: { companyId } })).data.contracts;
export const saveContract = async (companyId: string, id: string | null, body: Record<string, unknown>) =>
  id ? (await accountingApi.put(`${base}/contracts/${id}`, body)).data : (await accountingApi.post(`${base}/contracts`, { companyId, ...body })).data;
export const deleteContract = async (id: string) => (await accountingApi.delete(`${base}/contracts/${id}`)).data;
export const getContractReport = async (companyId: string, month: string): Promise<ContractReport> =>
  (await accountingApi.get(`${base}/contracts/report`, { params: { companyId, month } })).data;
