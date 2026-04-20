"use client";

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { fetchWithAuth } from '@/lib/api';
import { Transaction, AccountCategory } from '@/types';
import MatchBadge from '@/components/MatchBadge';
import CategorySelector from '@/components/CategorySelector';
import { useLanguage } from '@/context/LanguageContext';

export default function AuditShieldPage() {
  const { id } = useParams();
  const { t } = useLanguage();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const txRes = await fetchWithAuth(`/companies/${id}/transactions/`);
      const allTxs = await txRes.json();
      // Only show unverified ones in Audit Shield
      const unverified = allTxs.filter((tx: Transaction) => !tx.is_verified);
      setTransactions(unverified.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));

      const catRes = await fetchWithAuth(`/companies/${id}/categories/`);
      setCategories(await catRes.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleSelect = (txId: number) => {
    setSelectedIds(prev => 
      prev.includes(txId) ? prev.filter(id => id !== txId) : [...prev, txId]
    );
  };

  const handleSelectAll = () => {
    if (selectedIds.length === transactions.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(transactions.map(t => t.id));
    }
  };

  const handleVerifySelected = async () => {
    if (selectedIds.length === 0) return;
    setIsProcessing(true);
    try {
      // In a real app, we'd have a bulk-verify endpoint that takes IDs.
      // For now, we use the all-verify if they select all, or iterate.
      // But let's assume we can iterate for simplicity in this MVP.
      await Promise.all(selectedIds.map(txId => 
        fetchWithAuth(`/companies/${id}/transactions/${txId}`, {
          method: 'PATCH',
          body: JSON.stringify({ is_verified: true })
        })
      ));
      setSelectedIds([]);
      await loadData();
    } catch (e) {
      alert(t('common.error'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVerifyAll = async () => {
    if (!id || !confirm(t('transactions.verifyAllConfirm'))) return;
    setIsProcessing(true);
    try {
        await fetchWithAuth(`/companies/${id}/transactions/bulk-verify`, {
            method: 'POST'
        });
        await loadData();
    } catch (e) {
        alert(t('common.error'));
    } finally {
        setIsProcessing(false);
    }
  };

  if (loading && transactions.length === 0) return <div style={{ padding: '40px', textAlign: 'center' }}>{t('common.loading')}</div>;

  const highConfidence = transactions.filter(t => t.match_type === "REFERENCE" || t.match_type === "RULE").length;
  const lowConfidence = transactions.filter(t => t.match_type === "AI" || t.match_type === "UNMATCHED").length;

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '36px', fontWeight: '800', marginBottom: '8px', background: 'linear-gradient(135deg, #fff 0%, #94a3b8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            🛡️ {t('audit.title')}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '16px' }}>{t('audit.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            onClick={handleVerifyAll}
            disabled={isProcessing || transactions.length === 0}
            className="btn-primary"
            style={{ 
              background: 'var(--blue-500)', 
              boxShadow: '0 0 20px rgba(59, 130, 246, 0.3)',
              border: 'none'
            }}
          >
            ✅ {t('audit.verifyAll')}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '32px' }}>
        <div className="card-glass" style={{ padding: '24px', borderLeft: '4px solid var(--green-500)' }}>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>{t('audit.confidenceHigh')}</div>
          <div style={{ fontSize: '32px', fontWeight: '800', color: 'var(--green-500)' }}>{highConfidence}</div>
          <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '8px' }}>Tarkat sääntö- ja viiteosumat.</p>
        </div>
        <div className="card-glass" style={{ padding: '24px', borderLeft: '4px solid var(--yellow-500)' }}>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>{t('audit.confidenceLow')}</div>
          <div style={{ fontSize: '32px', fontWeight: '800', color: 'var(--yellow-500)' }}>{lowConfidence}</div>
          <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '8px' }}>Vaativat kerran tarkistuksen.</p>
        </div>
      </div>

      <div className="card-glass" style={{ padding: '0', overflow: 'hidden' }}>
        <div style={{ 
          padding: '20px 24px', 
          background: 'rgba(255,255,255,0.03)', 
          borderBottom: '1px solid var(--glass-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <input 
              type="checkbox" 
              checked={selectedIds.length === transactions.length && transactions.length > 0}
              onChange={handleSelectAll}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <span style={{ fontWeight: '600' }}>{transactions.length} {t('sidebar.transactions').toLowerCase()} {t('dashboard.table.needsReview')}</span>
          </div>
          {selectedIds.length > 0 && (
            <button 
              onClick={handleVerifySelected}
              disabled={isProcessing}
              className="btn-primary"
              style={{ padding: '8px 20px', fontSize: '14px', background: 'var(--green-500)' }}
            >
              Vahvista merkityt ({selectedIds.length})
            </button>
          )}
        </div>

        {transactions.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.2)' }}>
                  <th style={{ padding: '12px 24px', textAlign: 'left', width: '40px' }}></th>
                  <th style={{ padding: '12px 24px', textAlign: 'left' }}>{t('common.date')}</th>
                  <th style={{ padding: '12px 24px', textAlign: 'left' }}>{t('common.description')}</th>
                  <th style={{ padding: '12px 24px', textAlign: 'left' }}>{t('common.category')}</th>
                  <th style={{ padding: '12px 24px', textAlign: 'right' }}>{t('common.amount')}</th>
                  <th style={{ padding: '12px 24px', textAlign: 'center' }}>Tila</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={tx.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'background 0.2s' }} className="hover-row">
                    <td style={{ padding: '16px 24px' }}>
                      <input 
                        type="checkbox" 
                        checked={selectedIds.includes(tx.id)}
                        onChange={() => handleToggleSelect(tx.id)}
                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ padding: '16px 24px', fontSize: '14px', whiteSpace: 'nowrap' }}>{tx.date}</td>
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ fontWeight: '600' }}>{tx.description}</div>
                      {tx.reference_number && <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Ref: {tx.reference_number}</div>}
                    </td>
                    <td style={{ padding: '16px 24px', minWidth: '250px' }}>
                      <CategorySelector 
                        companyId={id as string} 
                        initialCategoryId={tx.category_id}
                        onUpdate={async (catId) => {
                          const res = await fetchWithAuth(`/companies/${id}/transactions/${tx.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ category_id: catId })
                          });
                          const updated = await res.json();
                          setTransactions(prev => prev.map(t => t.id === tx.id ? updated : t));
                        }}
                        categories={categories}
                      />
                    </td>
                    <td style={{ 
                      padding: '16px 24px', 
                      textAlign: 'right', 
                      fontWeight: '800',
                      color: tx.amount >= 0 ? 'var(--green-500)' : 'white'
                    }}>
                      {tx.amount.toLocaleString('fi-FI', { minimumFractionDigits: 2 })} €
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                      <MatchBadge type={tx.match_type} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: '80px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>🛡️</div>
            <h3 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '12px' }}>{t('audit.empty')}</h3>
            <p style={{ color: 'var(--text-secondary)' }}>Kaikki yhtiön tapahtumat on suojattu ja vahvistettu kirjanpitoon.</p>
          </div>
        )}
      </div>

      <div style={{ marginTop: '24px', display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', borderRadius: '12px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
        <span style={{ fontSize: '20px' }}>💡</span>
        <p style={{ fontSize: '14px', color: 'var(--blue-400)', margin: 0 }}>
          {t('audit.guardianNotice')}
        </p>
      </div>
      
      <style jsx>{`
        .hover-row:hover {
          background: rgba(255,255,255,0.02);
        }
      `}</style>
    </div>
  );
}
