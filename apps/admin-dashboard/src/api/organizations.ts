import { companiesApi } from './companies';
import { authApi } from './auth';

export type CompanyRole = 'MANAGER' | 'ASSISTANT' | 'BOARD' | 'AUDITOR';
export type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export const COMPANY_ROLE_LABELS: Record<CompanyRole, string> = {
  MANAGER: 'Isännöitsijä',
  ASSISTANT: 'Kirjanpitoassistentti',
  BOARD: 'Hallitus (luku)',
  AUDITOR: 'Tarkastaja (luku)',
};

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  OWNER: 'Omistaja',
  ADMIN: 'Pääkäyttäjä',
  MEMBER: 'Työntekijä',
};

export interface CompanyRoleAssignment { companyId: string; role: CompanyRole; companyName?: string }

export const getMyOrganization = async () => {
  const { data } = await companiesApi.get('/organizations/me');
  return data as { organization: { id: string; name: string; businessId?: string; companyCount: number; memberCount: number } | null; role: OrgRole | null };
};

export const updateOrganization = async (id: string, body: { name?: string; businessId?: string }) =>
  (await companiesApi.patch(`/organizations/${id}`, body)).data;

export const getOrganizationUsers = async (id: string) => (await companiesApi.get(`/organizations/${id}/users`)).data as {
  id: string; email: string; firstName?: string; lastName?: string; isActive: boolean;
  orgRole: OrgRole | null; companyRoles: CompanyRoleAssignment[];
}[];

export const updateUserAccess = async (orgId: string, userId: string, body: { orgRole: OrgRole | null; companyRoles: CompanyRoleAssignment[] }) =>
  (await companiesApi.put(`/organizations/${orgId}/users/${userId}`, body)).data;

export const removeUser = async (orgId: string, userId: string) =>
  (await companiesApi.delete(`/organizations/${orgId}/users/${userId}`)).data;

export const getInvitations = async (orgId: string) => (await companiesApi.get(`/organizations/${orgId}/invitations`)).data as {
  id: string; email: string; orgRole: OrgRole | null; companyRoles: CompanyRoleAssignment[]; expiresAt: string; link: string;
}[];

export const createInvitation = async (orgId: string, body: { email: string; orgRole: OrgRole | null; companyRoles: CompanyRoleAssignment[] }) =>
  (await companiesApi.post(`/organizations/${orgId}/invitations`, body)).data as { link: string; email: string };

export const cancelInvitation = async (orgId: string, invitationId: string) =>
  (await companiesApi.delete(`/organizations/${orgId}/invitations/${invitationId}`)).data;

// Julkiset (ei kirjautumista): kutsulinkin avaaja
export const getPublicInvitation = async (token: string) => (await authApi.get(`/invitations/${token}`)).data as {
  email: string; organizationName: string; orgRole: OrgRole | null;
  companies: { name: string; role: string; roleLabel: string }[]; expiresAt: string; userExists: boolean;
};

export const acceptInvitation = async (token: string, body: { password: string; firstName?: string; lastName?: string; mfaToken?: string }) =>
  (await authApi.post(`/invitations/${token}/accept`, body)).data;
