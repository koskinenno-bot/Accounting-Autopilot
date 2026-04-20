"use client";

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { HousingCompany } from '@/types';

interface CompanyContextType {
  activeCompany: HousingCompany | null;
  setActiveCompany: (company: HousingCompany | null) => void;
  companies: HousingCompany[];
  setCompanies: (companies: HousingCompany[]) => void;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [activeCompany, setActiveCompany] = useState<HousingCompany | null>(null);
  const [companies, setCompanies] = useState<HousingCompany[]>([]);

  return (
    <CompanyContext.Provider value={{ activeCompany, setActiveCompany, companies, setCompanies }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
}
