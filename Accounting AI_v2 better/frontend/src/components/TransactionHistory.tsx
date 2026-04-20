import { useState, useEffect } from 'react';
import { fetchWithAuth } from '@/lib/api';
import { TransactionAudit } from '@/types';
import { useLanguage } from '@/context/LanguageContext';

export default function TransactionHistory({ companyId, transactionId, onClose }: { companyId: number, transactionId: number, onClose: () => void }) {
  const { t } = useLanguage();
  const [logs, setLogs] = useState<TransactionAudit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadLogs() {
      try {
        const res = await fetchWithAuth(`/companies/${companyId}/compliance/transactions/${transactionId}/audit-log`);
        const data = await res.json();
        setLogs(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadLogs();
  }, [transactionId, companyId]);

  return (
    <div style={{
      position: 'absolute',
      right: '0',
      top: '100%',
      zIndex: 100,
      width: '320px',
      background: 'var(--glass-bg)',
      backdropFilter: 'blur(16px)',
      border: '1px solid var(--glass-border)',
      borderRadius: '12px',
      padding: '16px',
      boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
      marginTop: '8px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h4 style={{ margin: 0, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('transactions.audit.title')}</h4>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '16px' }}>&times;</button>
      </div>

      {loading ? (
        <div style={{ padding: '20px', textAlign: 'center', fontSize: '12px', opacity: 0.5 }}>{t('common.loading')}</div>
      ) : logs.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', fontSize: '12px', opacity: 0.5 }}>{t('transactions.audit.noChanges')}</div>
      ) : (
        <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {logs.map((log) => (
            <div key={log.id} style={{ fontSize: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.6, marginBottom: '4px' }}>
                <span>{new Date(log.changed_at).toLocaleString(t('common.locale'))}</span>
                <span style={{ fontWeight: '700' }}>{log.field}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--red-400)', textDecoration: 'line-through', opacity: 0.8 }}>{log.old_value || t('transactions.audit.empty')}</span>
                <span style={{ opacity: 0.5 }}>→</span>
                <span style={{ color: 'var(--green-400)', fontWeight: '600' }}>{log.new_value || t('transactions.audit.empty')}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '12px', borderTop: '1px solid var(--glass-border)', paddingTop: '8px', fontSize: '10px', opacity: 0.4, fontStyle: 'italic', lineHeight: '1.4' }}>
        {t('transactions.audit.legalNotice')}
      </div>
    </div>
  );
}
