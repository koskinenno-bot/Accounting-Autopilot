"use client";

import { useCompany } from '@/context/CompanyContext';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { fetchWithAuth } from '@/lib/api';
import BillingDashboard from '@/components/BillingDashboard';

export default function BillingPage() {
  const { id } = useParams();
  const { setActiveCompany } = useCompany();

  useEffect(() => {
    async function loadCompany() {
      if (!id) return;
      try {
        const res = await fetchWithAuth(`/companies/${id}`);
        const data = await res.json();
        setActiveCompany(data);
      } catch (err) {
        console.error(err);
      }
    }
    loadCompany();
  }, [id, setActiveCompany]);

  return <BillingDashboard />;
}
