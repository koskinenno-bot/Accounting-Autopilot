"use client";

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { fetchWithAuth } from '@/lib/api';
import { HousingCompany, MatchingRule, AccountCategory } from '@/types';
import { useCompany } from '@/context/CompanyContext';
import { useLanguage } from '@/context/LanguageContext';
import CategorySelector from '@/components/CategorySelector';

export default function SettingsPage() {
  const { id } = useParams();
  const { setActiveCompany } = useCompany();
  const { t } = useLanguage();
  const [company, setCompany] = useState<HousingCompany | null>(null);
  const [rules, setRules] = useState<MatchingRule[]>([]);
  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [keywordPattern, setKeywordPattern] = useState("");
  const [ibanPattern, setIbanPattern] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const compRes = await fetchWithAuth(`/companies/${id}`);
      const companyData: HousingCompany = await compRes.json();
      setCompany(companyData);
      setActiveCompany(companyData);

      // Fetch rules
      const rulesRes = await fetchWithAuth(`/companies/${id}/rules`);
      setRules(await rulesRes.json());
      
      // Fetch categories
      const catRes = await fetchWithAuth(`/companies/${id}/categories/`);
      const catData = await catRes.json();
      setCategories(Array.isArray(catData) ? catData : []);
      
      if (catData && catData.length > 0) {
        setSelectedCategoryId(catData[0].id.toString());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id, setActiveCompany]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || (!keywordPattern.trim() && !ibanPattern.trim()) || !selectedCategoryId) return;

    try {
      await fetchWithAuth(`/companies/${id}/rules`, {
        method: 'POST',
        body: JSON.stringify({
          keyword_pattern: keywordPattern || null,
          iban: ibanPattern || null,
          account_category_id: parseInt(selectedCategoryId)
        })
      });
      setKeywordPattern("");
      setIbanPattern("");
      loadData();
    } catch(err) {
      console.error(err);
      alert(t('settings.saveError'));
    }
  };

  const handleDeleteRule = async (ruleId: number) => {
    if (!id) return;
    try {
      await fetchWithAuth(`/companies/${id}/rules/${ruleId}`, {
        method: 'DELETE'
      });
      loadData();
    } catch(err) {
      console.error(err);
      alert(t('settings.saveError'));
    }
  };

  if (loading && rules.length === 0) return <div>{t('common.loading')}</div>;
  if (!company) return <div>{t('dashboard.notFound')}</div>;

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '8px' }}>{t('settings.title')}</h1>
        <p style={{ color: 'var(--text-secondary)' }}>{t('settings.subtitle')}</p>
      </div>

      <div className="card-glass" style={{ padding: '24px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>{t('transactions.audit.title')}</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
          {t('billing.tipContent')}
        </p>

        {/* Note: In a real app we'd have more settings here, but for now we follow the existing pattern */}
        <form onSubmit={handleCreateRule} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '12px', alignItems: 'flex-end', marginBottom: '32px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>{t('common.category')} (Regex)</label>
            <input 
              type="text" 
              value={keywordPattern}
              onChange={(e) => setKeywordPattern(e.target.value)}
              placeholder="e.g. Fortum|Helen"
              style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.05)', color: 'white' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>{t('dashboard.iban')}</label>
            <input 
              type="text" 
              value={ibanPattern}
              onChange={(e) => setIbanPattern(e.target.value)}
              placeholder="e.g. FI1234..."
              style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.05)', color: 'white' }}
            />
          </div>
          <div style={{ minWidth: '220px' }}>
            <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>{t('common.category')}</label>
            <CategorySelector 
               companyId={id as string}
               initialCategoryId={selectedCategoryId ? parseInt(selectedCategoryId) : null}
               onUpdate={(id) => setSelectedCategoryId(id.toString())}
               categories={categories}
            />
          </div>
          <button type="submit" className="btn-primary" style={{ height: '42px', padding: '0 24px' }}>
            {t('common.save')}
          </button>
        </form>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {rules.map(rule => (
            <div key={rule.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
              <div>
                <div style={{ fontWeight: '500', fontSize: '15px', color: 'var(--blue-400)' }}>
                  {rule.keyword_pattern && <code style={{ fontFamily: 'monospace' }}>{rule.keyword_pattern}</code>}
                  {rule.keyword_pattern && rule.iban && <span style={{ margin: '0 8px', color: 'var(--text-secondary)' }}>|</span>}
                  {rule.iban && <code style={{ fontFamily: 'monospace' }}>{rule.iban}</code>}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  → {rule.category_code} ({rule.category_name})
                </div>
              </div>
              <button onClick={() => handleDeleteRule(rule.id)} style={{ background: 'transparent', border: 'none', color: 'var(--red-500)', cursor: 'pointer', fontWeight: 'bold' }}>
                {t('common.delete')}
              </button>
            </div>
          ))}
          {rules.length === 0 && (
             <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>{t('transactions.audit.noChanges')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
