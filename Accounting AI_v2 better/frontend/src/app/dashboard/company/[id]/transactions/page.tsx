"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { fetchWithAuth } from '@/lib/api';
import { Transaction, HousingCompany, ImportJob, AccountCategory } from '@/types';
import MatchBadge from '@/components/MatchBadge';
import CsvUpload from '@/components/CsvUpload';
import CategorySelector from '@/components/CategorySelector';
import ReceiptManager from '@/components/ReceiptManager';
import ReceiptScanner from '@/components/ReceiptScanner';
import TransactionHistory from '@/components/TransactionHistory';
import { useCompany } from '@/context/CompanyContext';
import { useLanguage } from '@/context/LanguageContext';

export default function TransactionsPage() {
  const { id } = useParams();
  const { setActiveCompany } = useCompany();
  const { t } = useLanguage();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [company, setCompany] = useState<HousingCompany | null>(null);
  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [chartUploadResult, setChartUploadResult] = useState<any>(null);
  const [chartUploading, setChartUploading] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [lockedPeriods, setLockedPeriods] = useState<any[]>([]);
  const [showHistoryId, setShowHistoryId] = useState<number | null>(null);
  const chartFileRef = useRef<HTMLInputElement>(null);

  const hasChart = categories.length > 0;

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const lockRes = await fetchWithAuth(`/companies/${id}/compliance/locked-periods`);
      setLockedPeriods(await lockRes.json());
      const compRes = await fetchWithAuth(`/companies/${id}`);
      const companyData: HousingCompany = await compRes.json();
      setCompany(companyData);
      setActiveCompany(companyData);
      
      const txRes = await fetchWithAuth(`/companies/${id}/transactions/`);
      const fetchedTxs = await txRes.json();
      const sortedTxs = fetchedTxs.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setTransactions(sortedTxs);

      const jobsRes = await fetchWithAuth(`/companies/${id}/transactions/import-jobs`);
      setImportJobs(await jobsRes.json());

      const catRes = await fetchWithAuth(`/companies/${id}/categories/`);
      const catData = await catRes.json();
      setCategories(Array.isArray(catData) ? catData : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id, setActiveCompany]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleUploadSuccess = (results: any) => {
    setUploadResult(results);
    loadData();
  };

  const handleChartUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setChartUploading(true);
    setChartUploadResult(null);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetchWithAuth(`/companies/${id}/categories/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      setChartUploadResult(data);
      await loadData();
    } catch (err: any) {
      alert(err.message || t('common.error'));
    } finally {
      setChartUploading(false);
      if (chartFileRef.current) chartFileRef.current.value = '';
    }
  };

  const handleUpdateCategory = async (txId: number, categoryId: number) => {
    if(!id) return;
    try {
        const res = await fetchWithAuth(`/companies/${id}/transactions/${txId}`, {
            method: 'PATCH',
            body: JSON.stringify({ category_id: categoryId })
        });
        const updatedTx = await res.json();
        setTransactions(prev => prev.map(t => t.id === txId ? updatedTx : t));
    } catch (e) {
        alert(t('common.error'));
        throw e;
    }
  };

  const handleToggleVerified = async (txId: number, currentStatus: boolean) => {
    if(!id) return;
    try {
        const res = await fetchWithAuth(`/companies/${id}/transactions/${txId}`, {
            method: 'PATCH',
            body: JSON.stringify({ is_verified: !currentStatus })
        });
        const updatedTx = await res.json();
        setTransactions(prev => prev.map(t => t.id === txId ? updatedTx : t));
    } catch (e) {
        alert(t('common.error'));
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

  const handleDeleteJob = async (jobId: number) => {
    if (!id || !confirm(t('transactions.history.rollbackConfirm'))) return;
    setIsProcessing(true);
    try {
      await fetchWithAuth(`/companies/${id}/transactions/import-jobs/${jobId}`, { method: 'DELETE' });
      await loadData();
    } catch(e) { 
      console.error(e); 
      alert(t('common.error')); 
    } finally {
      setIsProcessing(false);
    }
  };

  const handleScanComplete = (result: any) => {
    setScanResult(result);
  };

  const handleConfirmMatch = async () => {
    if (!id || !scanResult || !scanResult.suggested_transaction_id) return;
    setIsProcessing(true);
    try {
        const body: any = { 
            receipt_url: scanResult.receipt_url 
        };
        if (scanResult.suggested_category_code) {
            const cat = categories.find(c => c.code === scanResult.suggested_category_code);
            if (cat) body.category_id = cat.id;
        }

        await fetchWithAuth(`/companies/${id}/transactions/${scanResult.suggested_transaction_id}`, {
            method: 'PATCH',
            body: JSON.stringify(body)
        });
        
        setScanResult(null);
        await loadData();
    } catch (e) {
        alert(t('common.error'));
    } finally {
        setIsProcessing(false);
    }
  };

  if (loading && transactions.length === 0) return <div>{t('common.loading')}</div>;
  if (!company) return <div>{t('dashboard.notFound')}</div>;

  const unverifiedCount = transactions.filter(t => !t.is_verified).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '8px' }}>{t('transactions.title')}</h1>
          <p style={{ color: 'var(--text-secondary)' }}>{t('transactions.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {unverifiedCount > 0 && (
            <button 
              onClick={handleVerifyAll}
              disabled={isProcessing}
              className="btn-primary"
              style={{ background: 'var(--green-500)', display: 'flex', gap: '8px', alignItems: 'center' }}
            >
              <span>{isProcessing ? '⏳' : '🛡️'}</span> {isProcessing ? t('transactions.processing') : `${t('transactions.verifyAll')} (${unverifiedCount})`}
            </button>
          )}
        </div>
      </div>

      <div className="card-glass" style={{ padding: '28px', marginBottom: '28px' }}>
        <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '20px' }}>{t('transactions.setup.title')}</h3>
        
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <div style={{
            flex: '1 1 280px',
            padding: '20px',
            borderRadius: '12px',
            border: hasChart ? '2px solid var(--green-500)' : '2px solid var(--blue-400)',
            background: hasChart ? 'rgba(16, 185, 129, 0.06)' : 'rgba(59, 130, 246, 0.06)',
            position: 'relative',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '14px', fontWeight: '800',
                background: hasChart ? 'var(--green-500)' : 'var(--blue-400)',
                color: 'white',
              }}>
                {hasChart ? '✓' : '1'}
              </div>
              <h4 style={{ fontWeight: '700', fontSize: '16px' }}>
                {t('transactions.setup.step1')}
              </h4>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: '1.5' }}>
              {t('transactions.setup.step1Sub')}
            </p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              {hasChart ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--green-500)', fontWeight: '700', fontSize: '14px' }}>
                    ✅ {categories.length} {t('transactions.setup.accountsLoaded')}
                  </span>
                  <button
                    onClick={() => chartFileRef.current?.click()}
                    disabled={chartUploading}
                    className="btn-secondary"
                    style={{ padding: '6px 14px', fontSize: '12px' }}
                  >
                    {chartUploading ? t('transactions.setup.uploading') : t('transactions.setup.replace')}
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => chartFileRef.current?.click()}
                    disabled={chartUploading || isProcessing}
                    className="btn-primary"
                    style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
                  >
                    <span>{chartUploading ? '⏳' : '📄'}</span>
                    {chartUploading ? t('transactions.setup.uploading') : t('transactions.setup.step1')}
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm("Haluatko ladata suomalaisen taloyhtiön standarditilikartan (TALO-2024)?")) return;
                      setIsProcessing(true);
                      try {
                        await fetchWithAuth(`/companies/${id}/categories/template`, { method: 'POST' });
                        await loadData();
                      } catch (e) { alert("Virhe ladattaessa mallia"); }
                      finally { setIsProcessing(false); }
                    }}
                    disabled={chartUploading || isProcessing}
                    className="btn-secondary"
                    style={{ border: '1px solid var(--blue-400)', color: 'var(--blue-400)' }}
                  >
                    💡 Käytä standardia
                  </button>
                </>
              )}
            </div>
            <input
              type="file"
              accept=".csv,.pdf,.tkt,.txt"
              ref={chartFileRef}
              style={{ display: 'none' }}
              onChange={handleChartUpload}
            />
          </div>

          <div style={{
            flex: '1 1 280px',
            padding: '20px',
            borderRadius: '12px',
            border: transactions.length > 0 ? '2px solid var(--green-500)' : hasChart ? '2px solid var(--blue-400)' : '2px solid rgba(255,255,255,0.1)',
            background: transactions.length > 0 ? 'rgba(16, 185, 129, 0.06)' : hasChart ? 'rgba(59, 130, 246, 0.06)' : 'rgba(255,255,255,0.02)',
            opacity: hasChart ? 1 : 0.5,
            position: 'relative',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '14px', fontWeight: '800',
                background: transactions.length > 0 ? 'var(--green-500)' : hasChart ? 'var(--blue-400)' : 'rgba(255,255,255,0.15)',
                color: 'white',
              }}>
                {transactions.length > 0 ? '✓' : '2'}
              </div>
              <h4 style={{ fontWeight: '700', fontSize: '16px' }}>
                {t('transactions.setup.step2')}
              </h4>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: '1.5' }}>
              {hasChart 
                ? t('transactions.setup.step2Sub')
                : t('transactions.setup.step2Locked')}
            </p>
            {hasChart ? (
              <CsvUpload companyId={company.id} onUploadSuccess={handleUploadSuccess} />
            ) : (
              <button
                disabled
                className="btn-primary"
                style={{ opacity: 0.4, cursor: 'not-allowed', display: 'flex', gap: '8px', alignItems: 'center' }}
              >
                <span>🔒</span> {t('transactions.setup.step2')}
              </button>
            )}
          </div>
        </div>

        {chartUploadResult && (
          <div style={{ marginTop: '16px', padding: '12px 16px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.08)', borderLeft: '4px solid var(--green-500)' }}>
            <span style={{ color: 'var(--green-500)', fontWeight: '700' }}>✅ {t('common.success')}!</span>
            <span style={{ color: 'var(--text-secondary)', marginLeft: '8px', fontSize: '13px' }}>{chartUploadResult.added} {t('transactions.setup.accountsLoaded')}.</span>
          </div>
        )}
        {uploadResult && (
          <div style={{ marginTop: '12px', padding: '12px 16px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.08)', borderLeft: '4px solid var(--green-500)' }}>
            <span style={{ color: 'var(--green-500)', fontWeight: '700' }}>✅ {t('common.success')}!</span>
            <span style={{ color: 'var(--text-secondary)', marginLeft: '8px', fontSize: '13px' }}>
              {uploadResult.total_imported} {t('transactions.title').toLowerCase()} — {uploadResult.reference_matches} {t('transactions.badge.reference')}, {uploadResult.rule_matches} {t('transactions.badge.rule')}, {uploadResult.ai_matches} {t('transactions.badge.ai')} matches.
            </span>
          </div>
        )}
      </div>

      {importJobs.length > 0 && (
        <div className="card-glass" style={{ padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>{t('transactions.historyTitle')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {importJobs.map(job => (
              <div key={job.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                <div>
                  <div style={{ fontWeight: '600' }}>{job.filename}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{t('transactions.history.imported')}: {new Date(job.created_at).toLocaleString(t('common.locale'))}</div>
                </div>
                <button 
                  onClick={() => handleDeleteJob(job.id)}
                  disabled={isProcessing}
                  className="btn-secondary"
                  style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--red-500)', borderColor: 'rgba(239, 68, 68, 0.2)', padding: '6px 16px', fontSize: '12px' }}>
                  {isProcessing ? t('transactions.wait') : t('transactions.rollback')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      
      <div style={{ marginBottom: '28px' }}>
        <ReceiptScanner 
          companyId={id as string} 
          onScanComplete={handleScanComplete} 
        />
        
        {scanResult && (
          <div className="card-glass" style={{ 
            marginTop: '12px', 
            padding: '20px', 
            border: '2px solid var(--green-500)', 
            background: 'rgba(16, 185, 129, 0.05)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <div style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--green-500)', fontWeight: '800', marginBottom: '8px' }}>
                {t('transactions.aiScanResult')}
              </div>
              <div style={{ display: 'flex', gap: '24px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{t('transactions.vendor')}</div>
                  <div style={{ fontWeight: '700' }}>{scanResult.vendor}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{t('common.amount')}</div>
                  <div style={{ fontWeight: '700' }}>{scanResult.amount.toFixed(2)} €</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{t('common.date')}</div>
                  <div style={{ fontWeight: '700' }}>{scanResult.date}</div>
                </div>
                {scanResult.suggested_category_code && (
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{t('common.category')}</div>
                    <div style={{ fontWeight: '700', color: 'var(--blue-400)' }}>
                      {categories.find(c => c.code === scanResult.suggested_category_code)?.name || scanResult.suggested_category_code}
                    </div>
                  </div>
                )}
              </div>
              
              {scanResult.suggested_transaction_id ? (
                <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', background: 'var(--green-500)', color: 'white', padding: '2px 8px', borderRadius: '4px', fontWeight: '800' }}>{t('transactions.matchFound')}</span>
                  <span style={{ fontSize: '13px' }}>AI found a matching bank transaction!</span>
                </div>
              ) : (
                <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', background: 'var(--yellow-500)', color: 'black', padding: '2px 8px', borderRadius: '4px', fontWeight: '800' }}>{t('transactions.noMatch')}</span>
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>No matching bank transaction found for this date/amount.</span>
                </div>
              )}
            </div>
            
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => setScanResult(null)}
                className="btn-secondary"
              >
                {t('transactions.dismiss')}
              </button>
              {scanResult.suggested_transaction_id && (
                <button 
                  onClick={handleConfirmMatch}
                  disabled={isProcessing}
                  className="btn-primary"
                  style={{ background: 'var(--green-500)', padding: '10px 24px' }}
                >
                  {isProcessing ? t('transactions.linking') : t('transactions.linkToTransaction')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="table-container card-glass" style={{ marginTop: '24px' }}>
        <table>
          <thead>
            <tr>
              <th>{t('common.date')}</th>
              <th>{t('common.description')}</th>
              <th>{t('common.status')}</th>
              <th>{t('transactions.table.receipt')}</th>
              <th>{t('transactions.table.category')}</th>
              <th style={{ textAlign: 'right' }}>{t('common.amount')}</th>
              <th style={{ textAlign: 'center' }}>{t('transactions.table.audit')}</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map(tx => {
              const isPeriodLocked = lockedPeriods.some(lp => lp.year === new Date(tx.date).getFullYear() && lp.month === (new Date(tx.date).getMonth() + 1));
              
              return (
              <tr key={tx.id} style={{ opacity: tx.is_verified ? 0.7 : 1, position: 'relative' }}>
                <td style={{ whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                  <div style={{ fontSize: '14px' }}>{tx.date}</div>
                  {tx.accounting_date && tx.accounting_date !== tx.date && (
                    <div style={{ fontSize: '11px', color: 'var(--yellow-400)', marginTop: '2px' }}>
                      {t('transactions.accountingDate')}: {tx.accounting_date}
                    </div>
                  )}
                  {tx.voucher_number && (
                    <div style={{ fontSize: '11px', color: 'var(--blue-400)', fontWeight: '800', marginTop: '4px' }}>
                      {t('transactions.voucher')}: {tx.voucher_number}
                    </div>
                  )}
                </td>
                <td style={{ maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle' }}>
                  <div style={{ fontWeight: tx.is_verified ? '400' : '600' }}>{tx.description}</div>
                  {tx.reference_number && <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Ref: {tx.reference_number}</div>}
                  {tx.is_partial_payment && <div style={{ fontSize: '10px', color: '#fbbf24', fontWeight: 'bold' }}>⚠️ PARTIAL</div>}
                </td>
                <td style={{ verticalAlign: 'middle' }}><MatchBadge type={tx.match_type} /></td>
                <td style={{ verticalAlign: 'middle' }}>
                  <ReceiptManager 
                    companyId={id as string} 
                    transactionId={tx.id} 
                    initialReceiptUrl={tx.receipt_url}
                    onUpdate={(newUrl) => {
                      setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, receipt_url: newUrl } : t));
                    }}
                    disabled={isPeriodLocked}
                  />
                </td>
                <td style={{ minWidth: '300px', verticalAlign: 'middle' }}>
                  <CategorySelector 
                    companyId={id as string} 
                    initialCategoryId={tx.category_id}
                    onUpdate={(catId) => handleUpdateCategory(tx.id, catId)}
                    categories={categories}
                    disabled={tx.is_verified || isPeriodLocked}
                  />
                  {tx.matched_apartment_number && <div style={{ fontSize: '11px', color: 'var(--blue-400)', marginTop: '4px' }}>{t('transactions.target')}: {tx.matched_apartment_number}</div>}
                </td>
                <td style={{ 
                    textAlign: 'right', 
                    color: tx.amount >= 0 ? 'var(--green-500)' : 'var(--text-primary)', 
                    fontWeight: '700',
                    verticalAlign: 'middle',
                    fontSize: '15px'
                }}>
                  {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString(t('common.locale'), { minimumFractionDigits: 2 })} €
                </td>
                <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    {isPeriodLocked ? (
                      <span style={{ fontSize: '18px' }} title={t('transactions.periodLocked')}>🔒</span>
                    ) : (
                      <button 
                        onClick={() => handleToggleVerified(tx.id, tx.is_verified)}
                        style={{
                            padding: '8px 16px',
                            borderRadius: '6px',
                            border: '1px solid',
                            fontSize: '11px',
                            fontWeight: '700',
                            textTransform: 'uppercase',
                            transition: 'all 0.2s',
                            cursor: 'pointer',
                            background: tx.is_verified ? 'var(--green-500)' : 'transparent',
                            color: tx.is_verified ? 'white' : 'var(--yellow-500)',
                            borderColor: tx.is_verified ? 'var(--green-500)' : 'var(--yellow-500)',
                        }}
                      >
                            {tx.is_verified ? t('transactions.verified') : t('transactions.verify')}
                      </button>
                    )}
                    
                    {tx.is_verified && (
                      <div style={{ position: 'relative' }}>
                        <button 
                          onClick={() => setShowHistoryId(showHistoryId === tx.id ? null : tx.id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-secondary)',
                            fontSize: '11px',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            opacity: 0.7
                          }}
                        >
                          📜 {t('transactions.audit.title')}
                        </button>
                        {showHistoryId === tx.id && (
                          <TransactionHistory 
                            companyId={Number(id)}
                            transactionId={tx.id} 
                            onClose={() => setShowHistoryId(null)} 
                          />
                        )}
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            )})}
            {transactions.length === 0 && (
              <tr>
                 <td colSpan={7} style={{ textAlign: 'center', padding: '60px', color: 'var(--text-secondary)' }}>
                   {hasChart 
                     ? t('transactions.table.noTransactions')
                     : t('transactions.setup.step2Locked')}
                 </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
