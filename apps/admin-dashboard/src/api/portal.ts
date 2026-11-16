import { authApi } from './auth';
import { invoicesApi } from './invoices';
import { companiesApi } from './companies';

/** Osakasportaali: osakkaan omat vastikelaskut ja isännöitsijän kutsut. */

export interface PortalInvoice {
  id: string; invoiceNumber: string; apartment: string | null; period: string | null; kind: string;
  issueDate: string; dueDate: string; totalAmount: number; paidAmount: number; open: number; overdue: boolean; status: string;
  referenceNumber: string | null; lines: { description: string; amount: number }[]; payments: { amount: number; paidOn: string }[];
  barcode: string | null;
}
export interface PortalCompany {
  companyId: string; companyName: string; iban: string | null; bic: string | null; apartments: string[];
  openTotal: number; overdueTotal: number; invoices: PortalInvoice[];
}
export const getPortalInvoices = async () =>
  (await invoicesApi.get('/invoices/portal')).data as { user: { email: string; firstName: string | null; lastName: string | null } | null; companies: PortalCompany[] };

export const getPortalInvitation = async (token: string) =>
  (await authApi.get(`/portal/invitations/${token}`)).data as { email: string; companyName: string; apartments: string; userExists: boolean; expiresAt: string };
export const acceptPortalInvitation = async (token: string, body: { password: string; firstName?: string; lastName?: string }) =>
  (await authApi.post(`/portal/invitations/${token}/accept`, body)).data as { user: { id: string; email: string; role: string }; token: string };

export interface PortalStatusRow { email: string; name: string; apartments: string; status: 'ACTIVE' | 'INVITED' | 'EXPIRED' | 'NONE'; invitedAt: string | null }
export const getPortalStatus = async (companyId: string) =>
  (await companiesApi.get('/shareholders/portal-status', { params: { companyId } })).data as { noEmail: number; shareholders: PortalStatusRow[] };
export const sendPortalInvitations = async (companyId: string, emails?: string[]) =>
  (await companiesApi.post('/shareholders/portal-invitations', { companyId, ...(emails ? { emails } : {}) })).data as {
    sent: number; skipped: { email: string; reason: string }[]; devLinks?: { email: string; link: string }[];
  };
