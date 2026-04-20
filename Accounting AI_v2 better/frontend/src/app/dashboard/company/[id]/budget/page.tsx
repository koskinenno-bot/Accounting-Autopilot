"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { fetchWithAuth } from '@/lib/api';
import { BudgetRead, AccountCategory } from '@/types';
import { useCompany } from '@/context/CompanyContext';
import { useLanguage } from '@/context/LanguageContext';

export default function BudgetPage() {
  const { id } = useParams();
  const { setActiveCompany } = useCompany();
  const { t } = useLanguage();
  const [budgets, setBudgets] = useState<BudgetRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => {
    async function loadData() {
      if (!id) return;
      try {
        setLoading(true);
        const bRes = await fetchWithAuth(`/companies/${id}/budgets/${year}`);
        setBudgets(await bRes.json());
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [id, year]);

  const handleUpdateBudget = async (catId: number, amount: number) => {
    setBudgets(prev => prev.map(b => b.category_id === catId ? { ...b, amount } : b));
  };

  const saveBudgets = async () => {
    setSaving(true);
    try {
      for (const b of budgets) {
        await fetchWithAuth(`/companies/${id}/budgets`, {
          method: 'POST',
          body: JSON.stringify({
            category_id: b.category_id,
            year: year,
            amount: b.amount
          })
        });
      }
      alert(t('budget.saveSuccess'));
    } catch (err) {
      alert(t('budget.saveError'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: '40px' }}>{t('common.loading')}</div>;

  return (
    <div>
      <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '8px' }}>{t('budget.title')}</h1>
          <p style={{ color: 'var(--text-secondary)' }}>{t('budget.subtitle')}: {year}</p>
        </div>
        <div style={{ display: 'flex', gap: '16px' }}>
          <select 
            value={year} 
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="input-glass"
            style={{ width: '120px' }}
          >
            {[2024, 2025, 2026].map(y => <option key={y} value={y} style={{ color: 'black' }}>{y}</option>)}
          </select>
          <button 
            onClick={saveBudgets} 
            disabled={saving}
            className="btn-primary"
            style={{ background: 'var(--green-500)' }}
          >
            {saving ? t('budget.saving') : t('budget.saveButton')}
          </button>
        </div>
      </div>

      <div className="card-glass" style={{ padding: '0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.05)', textAlign: 'left' }}>
              <th style={{ padding: '16px 24px', fontSize: '14px' }}>{t('budget.account')}</th>
              <th style={{ padding: '16px 24px', fontSize: '14px' }}>{t('budget.name')}</th>
              <th style={{ padding: '16px 24px', fontSize: '14px', textAlign: 'right', width: '250px' }}>{t('budget.amount')} (€ / {t('budget.year')})</th>
            </tr>
          </thead>
          <tbody>
            {budgets.map((b) => (
              <tr key={b.category_id} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                <td style={{ padding: '12px 24px', fontWeight: '700', fontFamily: 'monospace', color: 'var(--blue-400)' }}>
                  {b.category_code}
                </td>
                <td style={{ padding: '12px 24px', fontSize: '14px' }}>
                  {b.category_name}
                </td>
                <td style={{ padding: '12px 24px', textAlign: 'right' }}>
                  <input 
                    type="number"
                    value={b.amount}
                    onChange={(e) => handleUpdateBudget(b.category_id, parseFloat(e.target.value) || 0)}
                    className="input-glass"
                    style={{ textAlign: 'right', width: '150px' }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '32px', padding: '24px', background: 'rgba(245, 158, 11, 0.05)', borderRadius: '12px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
        <h4 style={{ color: 'var(--yellow-500)', marginBottom: '8px' }}>💡 {t('budget.tipsTitle')}</h4>
        <ul style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.6', margin: 0, paddingLeft: '20px' }}>
          <li>{t('budget.tip1')}</li>
          <li>{t('budget.tip2')}</li>
          <li>{t('budget.tip3')}</li>
        </ul>
      </div>
    </div>
  );
}
