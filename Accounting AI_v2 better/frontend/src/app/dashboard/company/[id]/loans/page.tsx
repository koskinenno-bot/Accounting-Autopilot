"use client";

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { fetchWithAuth } from '@/lib/api';
import { CompanyLoan, ApartmentLoanShare } from '@/types';
import { useLanguage } from '@/context/LanguageContext';

export default function LoansPage() {
  const { id } = useParams();
  const { t } = useLanguage();
  const [loans, setLoans] = useState<CompanyLoan[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLoan, setActiveLoan] = useState<CompanyLoan | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const loadLoans = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await fetchWithAuth(`/companies/${id}/loans/`);
      const data = await res.json();
      setLoans(data);
      if (data.length > 0 && !activeLoan) {
        setActiveLoan(data[0]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id, activeLoan]);

  useEffect(() => {
    loadLoans();
  }, [loadLoans]);

  const handleUpdateShare = async (shareId: number, value: number) => {
    try {
      await fetchWithAuth(`/companies/${id}/loans/shares/${shareId}?remaining_share=${value}`, {
        method: 'PATCH'
      });
      // Update local state
      if (activeLoan) {
        const updatedShares = activeLoan.shares.map(s => 
          s.id === shareId ? { ...s, remaining_share: value } : s
        );
        setActiveLoan({ ...activeLoan, shares: updatedShares });
      }
    } catch (err) {
      alert(t('common.error'));
    }
  };

  const handleAddLoan = async () => {
    const name = prompt(t('loans.loanName'));
    if (!name) return;
    
    try {
      const res = await fetchWithAuth(`/companies/${id}/loans/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          bank_name: "Pankki",
          total_amount: 0.0,
          interest_rate: 0.0
        })
      });
      if (res.ok) {
        loadLoans();
      }
    } catch (err) {
      alert(t('common.error'));
    }
  };

  if (loading && loans.length === 0) return <div style={{ padding: '40px', textAlign: 'center' }}>{t('common.loading')}</div>;

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifySelf: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: '32px', fontWeight: '800', marginBottom: '8px' }}>🏛️ {t('loans.title')}</h1>
          <p style={{ color: 'var(--text-secondary)' }}>{t('loans.subtitle')}</p>
        </div>
        <button className="btn-primary" onClick={handleAddLoan}>
          + {t('loans.addLoan')}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: '32px' }}>
        {/* Loan Sidebar */}
        <div>
          {loans.length === 0 ? (
            <div className="card-glass" style={{ padding: '32px', textAlign: 'center', opacity: 0.6 }}>
                 {t('loans.noLoans')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {loans.map(loan => (
                <div 
                  key={loan.id}
                  onClick={() => setActiveLoan(loan)}
                  className="card-glass"
                  style={{ 
                    padding: '20px', 
                    cursor: 'pointer',
                    borderLeft: activeLoan?.id === loan.id ? '4px solid var(--blue-500)' : '1px solid var(--glass-border)',
                    background: activeLoan?.id === loan.id ? 'rgba(255,255,255,0.05)' : 'var(--glass-bg)'
                  }}
                >
                  <div style={{ fontWeight: '700', fontSize: '16px', marginBottom: '4px' }}>{loan.name}</div>
                  <div style={{ fontSize: '13px', opacity: 0.6 }}>{loan.bank_name}</div>
                  <div style={{ marginTop: '12px', fontSize: '18px', fontWeight: '800' }}>
                    {loan.total_amount.toLocaleString('fi-FI')} €
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Share Details */}
        <div>
          {activeLoan ? (
            <div className="card-glass" style={{ padding: '32px' }}>
              <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '24px' }}>{activeLoan.name} - {t('loans.apartmentShares')}</h2>
              
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--glass-border)', color: 'var(--text-secondary)', fontSize: '13px' }}>
                      <th style={{ padding: '12px 16px', textAlign: 'left' }}>Huoneisto</th>
                      <th style={{ padding: '12px 16px', textAlign: 'right' }}>{t('loans.remainingShare')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeLoan.shares.map(share => (
                      <tr key={share.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '16px' }}>
                          <span style={{ fontWeight: '600' }}>{share.apartment?.apartment_number || 'Apt'}</span>
                          <div style={{ fontSize: '12px', opacity: 0.6 }}>{share.apartment?.owner_name}</div>
                        </td>
                        <td style={{ padding: '16px', textAlign: 'right' }}>
                          <input 
                            type="number"
                            defaultValue={share.remaining_share}
                            onBlur={(e) => handleUpdateShare(share.id, parseFloat(e.target.value))}
                            style={{ 
                              background: 'rgba(0,0,0,0.2)',
                              border: '1px solid var(--glass-border)',
                              color: 'white',
                              padding: '8px 12px',
                              borderRadius: '6px',
                              textAlign: 'right',
                              width: '150px'
                            }}
                          />
                          <span style={{ marginLeft: '8px' }}>€</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card-glass" style={{ height: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.3 }}>
                 Valitse laina nähdäksesi erittelyn.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
