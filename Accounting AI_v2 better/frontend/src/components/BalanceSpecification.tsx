"use client";

import { useLanguage } from '@/context/LanguageContext';
import { BalanceSpecificationReport } from '@/types';

export default function BalanceSpecification({ report }: { report: BalanceSpecificationReport }) {
  const { t } = useLanguage();
  
  const formatEuro = (amount: number) => {
    return `€${amount.toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="card-glass" style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: '40px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '800', marginBottom: '8px' }}>{t('reports.balanceSpecHeader')}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '16px' }}>{t('reports.asOf')} {new Date(report.date).toLocaleDateString(t('common.locale'))}</p>
      </div>

      {report.accounts.map((account) => (
        <div key={account.code} style={{ marginBottom: '48px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid var(--blue-500)', paddingBottom: '8px', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '800' }}>{account.code} {account.name}</h3>
            <span style={{ fontSize: '18px', fontWeight: '800' }}>{formatEuro(account.balance)}</span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>
                <th style={{ padding: '8px' }}>{t('reports.table.date')}</th>
                <th style={{ padding: '8px' }}>{t('reports.table.description')}</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>{t('reports.table.increase')}</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>{t('reports.table.decrease')}</th>
              </tr>
            </thead>
            <tbody>
              {account.items?.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '12px 8px', fontSize: '14px' }}>{new Date(item.date).toLocaleDateString(t('common.locale'))}</td>
                  <td style={{ padding: '12px 8px', fontSize: '14px' }}>{item.description}</td>
                  <td style={{ padding: '12px 8px', fontSize: '14px', textAlign: 'right', color: 'var(--green-400)' }}>
                    {item.increase !== 0 ? formatEuro(item.increase) : ''}
                  </td>
                  <td style={{ padding: '12px 8px', fontSize: '14px', textAlign: 'right', color: 'var(--red-400)' }}>
                    {item.decrease !== 0 ? formatEuro(item.decrease) : ''}
                  </td>
                </tr>
              )) || (
                <tr>
                  <td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    Ei tapahtumia tälle tilille.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={{ padding: '16px 8px', fontWeight: '700', textAlign: 'right' }}>{t('reports.accountBalance')}:</td>
                <td colSpan={2} style={{ padding: '16px 8px', fontWeight: '800', textAlign: 'right', fontSize: '16px' }}>{formatEuro(account.balance)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}

      <div style={{ marginTop: '40px', padding: '20px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
        {t('reports.balanceSpecFooter')}
      </div>
    </div>
  );
}
