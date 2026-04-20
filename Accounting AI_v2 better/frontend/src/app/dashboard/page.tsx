"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchWithAuth } from '@/lib/api';
import { useCompany } from '@/context/CompanyContext';
import { useLanguage } from '@/context/LanguageContext';

interface PortfolioStats {
  id: number;
  name: string;
  business_id: string;
  bank_account: string;
  unverified_transactions: number;
  unpaid_apartments: number;
  total_cash: number;
}

export default function PortfolioHub() {
  const [portfolio, setPortfolio] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { setCompanies, setActiveCompany } = useCompany();
  const { t } = useLanguage();

  useEffect(() => {
    async function loadPortfolio() {
      try {
        setLoading(true);
        const res = await fetchWithAuth('/companies/portfolio-stats');
        const data = await res.json();
        setPortfolio(data);
        
        setCompanies(data.map((c: any) => ({
          id: c.id,
          name: c.name,
          business_id: c.business_id,
          bank_account: c.bank_account
        })));
        
        setActiveCompany(null);
      } catch (err) {
        console.error("Failed to load portfolio stats", err);
      } finally {
        setLoading(false);
      }
    }
    
    loadPortfolio();
  }, [setCompanies, setActiveCompany]);

  const filtered = portfolio.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.business_id.includes(search)
  );

  const totalCash = portfolio.reduce((sum, c) => sum + (c.total_cash || 0), 0);
  const totalUnverified = portfolio.reduce((sum, c) => sum + (c.unverified_transactions || 0), 0);

  if (loading) return <div>{t('common.loading')}</div>;

  return (
    <div>
      <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '8px' }}>
            {t('dashboard.portfolioHubTitle')}
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>{t('dashboard.portfolioHubSub')}</p>
          <button 
            onClick={async () => {
              if (confirm("Haluatko luoda demo-aineiston (As Oy Demokoti)?")) {
                const res = await fetchWithAuth('/demo/seed', { method: 'POST' });
                const data = await res.json();
                alert(data.message + "\n\n" + data.csv_sample);
                window.location.reload();
              }
            }}
            style={{ 
              marginTop: '12px', 
              padding: '6px 12px', 
              fontSize: '11px', 
              background: 'transparent', 
              border: '1px solid var(--blue-500)', 
              color: 'var(--blue-500)',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            🚀 AKTIVOI DEMO-TILA
          </button>
        </div>
        
        <div style={{ display: 'flex', gap: '20px' }}>
             <div className="card-glass" style={{ padding: '12px 24px', textAlign: 'right', borderTop: '2px solid var(--blue-500)' }}>
                <div style={{ fontSize: '12px', opacity: 0.6, textTransform: 'uppercase' }}>Portfolio Cash</div>
                <div style={{ fontSize: '24px', fontWeight: '800' }}>{totalCash.toLocaleString('fi-FI')} €</div>
             </div>
             <div className="card-glass" style={{ padding: '12px 24px', textAlign: 'right', borderTop: '2px solid var(--red-500)' }}>
                <div style={{ fontSize: '12px', opacity: 0.6, textTransform: 'uppercase' }}>Unverified</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--red-400)' }}>{totalUnverified}</div>
             </div>
        </div>
      </div>

      <div style={{ marginBottom: '24px' }}>
          <input 
            type="text" 
            placeholder={t('common.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ 
                width: '100%', 
                padding: '12px 20px', 
                background: 'rgba(255,255,255,0.05)', 
                border: '1px solid var(--glass-border)',
                borderRadius: '99px',
                color: 'white',
                outline: 'none',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
            }}
          />
      </div>

      <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid var(--glass-border)' }}>
            <tr>
              <th style={{ textAlign: 'left', padding: '16px 24px', fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>{t('dashboard.table.buildingName')}</th>
              <th style={{ textAlign: 'left', padding: '16px 24px', fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>{t('dashboard.table.businessId')}</th>
              <th style={{ textAlign: 'center', padding: '16px 24px', fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>Kassavarat</th>
              <th style={{ textAlign: 'center', padding: '16px 24px', fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>{t('dashboard.table.unverified')}</th>
              <th style={{ textAlign: 'center', padding: '16px 24px', fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>{t('dashboard.table.unpaidApts')}</th>
              <th style={{ textAlign: 'right', padding: '16px 24px', fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>{t('dashboard.table.action')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c: any) => (
              <tr key={c.id} style={{ borderBottom: '1px solid var(--glass-border)', transition: 'background 0.2s' }}>
                <td style={{ padding: '16px 24px', fontWeight: '600' }}>{c.name}</td>
                <td style={{ padding: '16px 24px', color: 'var(--text-secondary)' }}>{c.business_id}</td>
                <td style={{ padding: '16px 24px', textAlign: 'center', fontWeight: '700' }}>{(c.total_cash || 0).toLocaleString('fi-FI')} €</td>
                <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                  <span style={{ 
                    background: c.unverified_transactions > 0 ? 'rgba(244, 63, 94, 0.2)' : 'rgba(34, 197, 94, 0.2)',
                    color: c.unverified_transactions > 0 ? '#fb7185' : '#4ade80',
                    padding: '4px 12px',
                    borderRadius: '99px',
                    fontSize: '11px',
                    fontWeight: '700'
                  }}>
                    {c.unverified_transactions} {t('dashboard.table.needsReview').toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                   <span style={{ 
                    background: c.unpaid_apartments > 0 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(34, 197, 94, 0.2)',
                    color: c.unpaid_apartments > 0 ? '#fbbf24' : '#4ade80',
                    padding: '4px 12px',
                    borderRadius: '99px',
                    fontSize: '11px',
                    fontWeight: '700'
                  }}>
                    {c.unpaid_apartments} {t('dashboard.table.unpaid').toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: '16px 24px', textAlign: 'right', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  {c.unverified_transactions > 0 && (
                    <Link href={`/dashboard/company/${c.id}/audit`}>
                      <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', border: '1px solid var(--yellow-500)', color: 'var(--yellow-500)', fontWeight: '600' }}>
                         🛡️ Audit
                      </button>
                    </Link>
                  )}
                  <Link href={`/dashboard/company/${c.id}`}>
                    <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '12px', fontWeight: '600' }}>
                       {t('dashboard.table.manage').toUpperCase()}
                    </button>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
