"use client";

import { useLanguage } from '@/context/LanguageContext';
import { GeneralLedgerReport, LedgerAccount } from '@/types';

export default function LedgerView({ report }: { report: GeneralLedgerReport }) {
  const { t } = useLanguage();
  
  const formatEuro = (amount: number) => {
    return `€${amount.toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const renderAccount = (account: LedgerAccount) => (
    <div key={account.code} id={`ledger-account-${account.code}`} style={{ 
      marginBottom: '40px', 
      background: 'rgba(255, 255, 255, 0.02)', 
      borderRadius: '12px', 
      border: '1px solid var(--glass-border)',
      overflow: 'hidden'
    }}>
      <div style={{ 
        padding: '16px 24px', 
        background: 'rgba(255, 255, 255, 0.05)', 
        borderBottom: '1px solid var(--glass-border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '18px', fontWeight: '900', color: 'var(--blue-400)', fontFamily: 'monospace' }}>{account.code}</span>
          <span style={{ fontSize: '16px', fontWeight: '700' }}>{account.name}</span>
        </div>
        <div style={{ fontSize: '18px', fontWeight: '800' }}>
          {t('reports.balance')}: <span style={{ color: account.balance >= 0 ? 'var(--green-400)' : 'var(--red-400)' }}>{formatEuro(account.balance)}</span>
        </div>
      </div>

      <div style={{ padding: '0 12px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-secondary)', fontSize: '12px' }}>
              <th style={{ padding: '12px' }}>{t('reports.table.date')}</th>
              <th style={{ padding: '12px' }}>{t('reports.table.voucher')}</th>
              <th style={{ padding: '12px' }}>{t('reports.table.description')}</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>{t('reports.debitLabel')}</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>{t('reports.creditLabel')}</th>
            </tr>
          </thead>
          <tbody>
            {account.entries.map((entry) => (
              <tr key={entry.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                <td style={{ padding: '10px 12px', fontSize: '13px', fontFamily: 'monospace', opacity: 0.8 }}>
                  {new Date(entry.date).toLocaleDateString(t('common.locale'))}
                </td>
                <td style={{ padding: '10px 12px', fontSize: '12px', fontFamily: 'monospace', color: entry.voucher_number ? 'var(--blue-400)' : 'var(--text-secondary)' }}>
                  {entry.voucher_number || '-'}
                  {entry.receipt_url && (
                    <a href={entry.receipt_url} target="_blank" rel="noreferrer" 
                       style={{ marginLeft: '8px', opacity: 0.6, textDecoration: 'none' }}
                       title={t('reports.viewReceipt')}
                    >
                      📄
                    </a>
                  )}
                </td>
                <td style={{ padding: '10px 12px', fontSize: '14px' }}>
                  {entry.description}
                  {!entry.is_verified && <span style={{ marginLeft: '8px', fontSize: '10px', color: 'var(--red-400)', textTransform: 'uppercase', border: '1px solid var(--red-500)', padding: '1px 4px', borderRadius: '3px' }}>{t('reports.unverified')}</span>}
                </td>
                <td style={{ padding: '10px 12px', fontSize: '13px', textAlign: 'right', color: 'var(--green-400)', fontFamily: 'monospace' }}>
                  {entry.amount > 0 ? formatEuro(entry.amount) : ''}
                </td>
                <td style={{ padding: '10px 12px', fontSize: '13px', textAlign: 'right', color: 'var(--red-400)', fontFamily: 'monospace' }}>
                  {entry.amount < 0 ? formatEuro(Math.abs(entry.amount)) : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: '700', fontSize: '13px' }}>
              <td colSpan={2} style={{ padding: '16px 12px', textAlign: 'right', color: 'var(--text-secondary)' }}>{t('reports.accountTotals')}:</td>
              <td style={{ padding: '16px 12px', textAlign: 'right', color: 'var(--green-400)' }}>{formatEuro(account.total_debit)}</td>
              <td style={{ padding: '16px 12px', textAlign: 'right', color: 'var(--red-400)' }}>{formatEuro(account.total_credit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  return (
    <div className="card-glass" style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '48px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '800', marginBottom: '8px', letterSpacing: '-0.02em' }}>{t('reports.ledgerHeader')}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '16px' }}>
          {new Date(report.period_start).toLocaleDateString(t('common.locale'))} – {new Date(report.period_end).toLocaleDateString(t('common.locale'))}
        </p>
      </div>

      {report.accounts.map(renderAccount)}

      {/* Summary Recap */}
      <div style={{ 
        marginTop: '24px', 
        padding: '30px', 
        background: 'rgba(255, 255, 255, 0.05)', 
        borderRadius: '16px', 
        border: '1px solid var(--glass-border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', gap: '48px' }}>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{t('reports.totalDebit')}</div>
            <div style={{ fontSize: '22px', fontWeight: '800', color: 'var(--green-400)' }}>{formatEuro(report.total_debit)}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{t('reports.totalCredit')}</div>
            <div style={{ fontSize: '22px', fontWeight: '800', color: 'var(--red-400)' }}>{formatEuro(report.total_credit)}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{t('reports.balanceRecap')}</div>
          <div style={{ fontSize: '32px', fontWeight: '900', color: Math.abs(report.total_debit - report.total_credit) < 0.01 ? 'var(--blue-400)' : 'var(--red-400)' }}>
             {formatEuro(report.total_debit - report.total_credit)}
          </div>
        </div>
      </div>

      <div style={{ marginTop: '48px', textAlign: 'center', fontSize: '11px', color: 'var(--text-secondary)', opacity: 0.5 }}>
        {t('reports.ledgerFooter')}
      </div>
    </div>
  );
}
