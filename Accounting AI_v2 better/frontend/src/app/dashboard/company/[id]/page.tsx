"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import KpiCard from '@/components/KpiCard';
import PaymentStatusWidget from '@/components/PaymentStatusWidget';
import { fetchWithAuth } from '@/lib/api';
import { DashboardKpi, PaymentStatus, HousingCompany } from '@/types';
import { useCompany } from '@/context/CompanyContext';
import { useLanguage } from '@/context/LanguageContext';
import InvoiceModal from '@/components/InvoiceModal';

export default function CompanyDashboard() {
  const { id } = useParams();
  const { setActiveCompany } = useCompany();
  const { t } = useLanguage();
  const [kpi, setKpi] = useState<DashboardKpi | null>(null);
  const [statuses, setStatuses] = useState<PaymentStatus[]>([]);
  const [company, setCompany] = useState<HousingCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<any>(null);
  const [selectedApartmentId, setSelectedApartmentId] = useState<number | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!id) return;
      try {
        setLoading(true);
        // Fetch company details
        const compRes = await fetchWithAuth(`/companies/${id}`);
        const companyData: HousingCompany = await compRes.json();
        setCompany(companyData);
        setActiveCompany(companyData);
        
        // Fetch KPIs
        const kpiRes = await fetchWithAuth(`/companies/${id}/reports/dashboard`);
        setKpi(await kpiRes.json());
        
        // Fetch Health
        const healthRes = await fetchWithAuth(`/companies/${id}/reports/health-check`);
        setHealth(await healthRes.json());
        
        // Fetch Payment Statuses
        const psRes = await fetchWithAuth(`/companies/${id}/reports/payment-status`);
        setStatuses(await psRes.json());
      } catch (err) {
        console.error("Failed to load company dashboard data", err);
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
  }, [id, setActiveCompany]);

  if (loading) return <div>{t('common.loading')}</div>;
  if (!company) return <div>{t('dashboard.notFound')}</div>;

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '8px' }}>
          {t('dashboard.overview')}: {company.name}
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>{t('dashboard.businessId')}: {company.business_id} | {t('dashboard.iban')}: {company.bank_account}</p>
      </div>

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        <KpiCard 
          title={t('dashboard.kpi.totalCash')} 
          value={`€${kpi?.total_cash.toFixed(2) || '0.00'}`} 
          type="neutral"
        />
        <KpiCard 
          title={t('dashboard.kpi.monthlyResult')} 
          value={`€${kpi?.monthly_result.toFixed(2) || '0.00'}`} 
          type={(kpi?.monthly_result || 0) >= 0 ? 'positive' : 'negative'}
        />
        <KpiCard 
          title={t('dashboard.kpi.paidApartments')} 
          value={`${kpi?.paid_apartments || 0} / ${kpi?.total_apartments || statuses.length}`} 
          type={(kpi?.paid_apartments || 0) === (kpi?.total_apartments || statuses.length) ? 'positive' : ((kpi?.paid_apartments || 0) > 0 ? 'neutral' : 'negative')}
        />
      </div>

      <div className="card-glass" style={{ margin: '24px 0', padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: health?.is_healthy ? '1px solid var(--green-500)' : '1px solid var(--orange-500)' }}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div style={{ fontSize: '32px' }}>{health?.is_healthy ? '✅' : '⚠️'}</div>
            <div>
              <div style={{ fontWeight: '700', fontSize: '18px' }}>Yhtiön terveys: {health?.is_healthy ? 'Kunnossa' : 'Vaatii huomiota'}</div>
              <div style={{ fontSize: '14px', opacity: 0.7 }}>
                {health?.unverified_count} vahvistamatonta | {health?.duplicate_count} mahdollista tuottaa
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '12px', opacity: 0.5 }}>Compliance Score</div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: health?.is_healthy ? 'var(--green-500)' : 'var(--orange-500)' }}>
                {health?.is_healthy ? '100%' : '85%'}
              </div>
          </div>
      </div>

      <PaymentStatusWidget
        statuses={statuses}
        companyId={id as string}
        onViewInvoice={(aptId) => setSelectedApartmentId(aptId)}
      />

      <InvoiceModal
        companyId={id as string}
        apartmentId={selectedApartmentId}
        onClose={() => setSelectedApartmentId(null)}
      />
    </div>
  );
}
