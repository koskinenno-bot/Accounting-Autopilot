import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCompanies } from '../api/companies';
import { getMyOrganization } from '../api/organizations';
import type { CompanyRole, OrgRole } from '../api/organizations';
import { useAuth } from './useAuth';

export interface Company {
  id: string;
  name: string;
  businessId: string;
  companyType?: 'AS_OY' | 'KOY';
  organizationId?: string | null;
  myRole: CompanyRole;
  fiscalYearStart?: string;
  fiscalYearEnd?: string;
}

interface CompanyContextType {
  companies: Company[] | undefined;
  isLoading: boolean;
  /** Valittu yhtiö (kaikki yhtiökohtaiset sivut käyttävät tätä). */
  selectedCompany: Company | undefined;
  selectCompany: (id: string) => void;
  /** Rooli valitussa yhtiössä */
  role: CompanyRole | undefined;
  canWrite: boolean;
  canManage: boolean;
  organization: { id: string; name: string } | null;
  orgRole: OrgRole | null;
  isOrgAdmin: boolean;
}

const STORAGE_KEY = 'selectedCompanyId';
const CompanyContext = createContext<CompanyContextType | null>(null);

const readStored = () => {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
};

export const CompanyProvider = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, user } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(readStored);

  const { data: companies, isLoading } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: getCompanies,
    enabled: isAuthenticated,
  });
  const { data: org } = useQuery({
    queryKey: ['my-organization', user?.id],
    queryFn: getMyOrganization,
    enabled: isAuthenticated,
  });

  // Valinta, joka ei ole enää listalla (toinen käyttäjä, poistettu oikeus) => ensimmäinen yhtiö
  const selectedCompany = useMemo(
    () => companies?.find((c) => c.id === selectedId) ?? companies?.[0],
    [companies, selectedId],
  );

  useEffect(() => {
    if (!isAuthenticated) setSelectedId(null);
  }, [isAuthenticated]);

  const selectCompany = (id: string) => {
    setSelectedId(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* yksityinen ikkuna */ }
  };

  const role = selectedCompany?.myRole;
  const orgRole = org?.role ?? null;
  const value: CompanyContextType = {
    companies,
    isLoading,
    selectedCompany,
    selectCompany,
    role,
    canWrite: role === 'MANAGER' || role === 'ASSISTANT',
    canManage: role === 'MANAGER',
    organization: org?.organization ?? null,
    orgRole,
    isOrgAdmin: orgRole === 'OWNER' || orgRole === 'ADMIN' || user?.role === 'SUPER_ADMIN',
  };
  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
};

export const useCompany = () => {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany must be used within CompanyProvider');
  return ctx;
};
