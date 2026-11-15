import { invoicesApi } from './invoices';
import { companiesApi } from './companies';

export type FeeBasis = 'SQM' | 'SHARES' | 'PERSONS' | 'PARKING' | 'FIXED';

export const BASIS_LABELS: Record<FeeBasis, string> = {
  SQM: '€/m²',
  SHARES: '€/osake',
  PERSONS: '€/henkilö',
  PARKING: '€/autopaikka',
  FIXED: '€/huoneisto',
};

export interface FeeComponent {
  id: string;
  name: string;
  basis: FeeBasis;
  unitPrice: number;
  accountNumber: string;
  loanCapital: boolean;
  loanAmount: number | null;
  isActive: boolean;
}

export interface Apartment {
  apartment: string;
  owners: { shareholderId: string; name: string; email?: string | null }[];
  squareMeters: number;
  shares: number;
  persons: number;
  parkingSpots: number;
  loanShares: { componentId: string; amount: number; paidOff: boolean }[];
}

export interface ReskontraSettings {
  referenceRate: number;
  reminderFee: number;
  reminderDaysAfterDue: number;
  paymentTermDays: number;
  saved: boolean;
  lateInterestRate?: number;
}

export interface FeeSetup {
  components: FeeComponent[];
  payoffs: { id: string; apartment: string; componentId: string; amount: number; paidOn: string; note: string | null }[];
  settings: ReskontraSettings;
  totalShares: number;
  apartments: Apartment[];
  apartmentsError: string | null;
}

export const getFeeSetup = async (companyId: string): Promise<FeeSetup> =>
  (await invoicesApi.get('/invoices/fees', { params: { companyId } })).data;

export const createDefaultComponents = async (companyId: string) =>
  (await invoicesApi.post('/invoices/fees/defaults', { companyId })).data;

export const createComponent = async (body: Partial<FeeComponent> & { companyId: string }) =>
  (await invoicesApi.post('/invoices/fees/components', body)).data;

export const updateComponent = async (id: string, body: Partial<FeeComponent>) =>
  (await invoicesApi.patch(`/invoices/fees/components/${id}`, body)).data;

export const createPayoff = async (body: { companyId: string; apartment: string; componentId: string; amount: number; paidOn: string; note?: string }) =>
  (await invoicesApi.post('/invoices/fees/payoffs', body)).data;

export const deletePayoff = async (id: string) => (await invoicesApi.delete(`/invoices/fees/payoffs/${id}`)).data;

export const updateReskontraSettings = async (body: Omit<ReskontraSettings, 'saved' | 'lateInterestRate'> & { companyId: string }) =>
  (await invoicesApi.put('/invoices/fees/settings', body)).data;

export interface FeeRunRow {
  apartment: string;
  recipientName: string;
  recipientEmail: string | null;
  lines: { description: string; quantity: number; unitPrice: number; amount: number; accountNumber: string }[];
  total: number;
  exempted: string[];
  alreadyBilled: boolean;
}

export const runFees = async (body: { companyId: string; period: string; issueDate: string; dueDate: string; dryRun: boolean }) =>
  (await invoicesApi.post('/invoices/fees/run', body)).data as
    { period: string; rows?: FeeRunRow[]; count?: number; created?: number; total: number; alreadyBilled: number };

export interface LedgerInvoice {
  id: string;
  invoiceNumber: string;
  referenceNumber: string | null;
  kind: 'FEE' | 'REMINDER' | 'OTHER';
  period: string | null;
  apartment: string | null;
  recipientName: string;
  status: string;
  issueDate: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  open: number;
  daysOverdue: number;
  lastReminderAt: string | null;
  lines: { description: string; amount: number; accountNumber: string | null }[];
  payments: { id: string; amount: number; paidOn: string; source: string; note: string | null }[];
}

export interface ApartmentBalance {
  apartment: string;
  recipientName: string;
  billed: number;
  paid: number;
  open: number;
  overdue: number;
  oldestDueDate: string | null;
  invoiceCount: number;
}

export const getReskontra = async (companyId: string): Promise<{ balances: ApartmentBalance[]; invoices: LedgerInvoice[] }> =>
  (await invoicesApi.get('/invoices/reskontra', { params: { companyId } })).data;

export const addPayment = async (invoiceId: string, body: { amount: number; paidOn: string; note?: string }) =>
  (await invoicesApi.post(`/invoices/${invoiceId}/payments`, body)).data;

export interface ReminderCandidate {
  invoiceId: string;
  invoiceNumber: string;
  referenceNumber: string | null;
  period: string | null;
  apartment: string | null;
  recipientName: string;
  recipientEmail: string | null;
  dueDate: string;
  open: number;
  daysOverdue: number;
  interest: number;
  fee: number;
  eligible: boolean;
  reason: string | null;
}

export const getReminders = async (companyId: string): Promise<{ settings: ReskontraSettings; candidates: ReminderCandidate[] }> =>
  (await invoicesApi.get('/invoices/reminders', { params: { companyId } })).data;

export const sendReminders = async (companyId: string, invoiceIds: string[]) =>
  (await invoicesApi.post('/invoices/reminders', { companyId, invoiceIds })).data as
    { sent: { invoiceId: string; total: number }[]; skipped: { invoiceId: string; reason: string }[] };

export interface ImportSummary {
  apartments: number;
  owners: number;
  errors: string[];
  warnings: string[];
  preview?: { number: string; squareMeters: number; shareNumbers: string[]; persons: number; parkingSpots: number; owners: { name: string; email: string }[] }[];
  imported: boolean;
}

export const importShareholders = async (companyId: string, csv: string, dryRun: boolean): Promise<ImportSummary> =>
  (await companiesApi.post('/shareholders/import', { companyId, csv, dryRun })).data;

export const updateApartment = async (body: { companyId: string; apartment: string; squareMeters?: number; persons?: number; parkingSpots?: number }) =>
  (await companiesApi.patch('/shareholders/apartment', body)).data;
