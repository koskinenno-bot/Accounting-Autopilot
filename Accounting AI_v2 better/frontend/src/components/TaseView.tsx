"use client";

import { useLanguage } from '@/context/LanguageContext';
import { BalanceSheet, ReportSection } from '@/types';

export default function TaseView({ report, onAccountClick }: { report: BalanceSheet, onAccountClick?: (code: string) => void }) {
  const { t } = useLanguage();
  
  const formatEuro = (amount: number) => {
    return `€${amount.toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const renderSection = (section: ReportSection) => (
    <div key={section.name} style={{ marginBottom: '24px' }}>
      <div style={{ 
        fontSize: '13px', 
        fontWeight: '700', 
        color: 'var(--text-secondary)', 
        textTransform: 'uppercase', 
        marginBottom: '10px', 
        paddingLeft: '4px',
        letterSpacing: '0.05em'
      }}>
        {section.name}
      </div>
      {section.lines.map(line => (
        <div key={line.code} 
          onClick={() => onAccountClick && onAccountClick(line.code)}
          style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            padding: '10px 16px', 
            borderBottom: '1px solid rgba(255,255,255,0.03)',
            transition: 'all 0.15s ease',
            borderRadius: '4px',
            cursor: onAccountClick ? 'pointer' : 'default'
          }}
          onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
          onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.995)'}
          onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
            <span style={{ opacity: 0.5, marginRight: '10px', fontFamily: 'monospace' }}>{line.code}</span>
            {line.name}
          </span>
          <span style={{ fontWeight: '600', fontFamily: 'monospace' }}>{formatEuro(line.amount)}</span>
        </div>
      ))}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        padding: '12px 16px', 
        fontWeight: '700', 
        fontSize: '15px',
        color: 'var(--text-primary)',
        marginTop: '2px',
        borderTop: '1px solid rgba(255,255,255,0.1)'
      }}>
        <span>{t('reports.total')} {section.name.toUpperCase()}</span>
        <span>{formatEuro(section.total)}</span>
      </div>
    </div>
  );

  return (
    <div className="card-glass" style={{ padding: '48px', maxWidth: '900px', margin: '0 auto', boxShadow: '0 30px 60px rgba(0,0,0,0.4)' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '56px', borderBottom: '2px solid var(--glass-border)', paddingBottom: '32px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '900', marginBottom: '8px', letterSpacing: '-0.03em' }}>{t('reports.balanceHeader')}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '18px', fontWeight: '500' }}>
          {t('reports.asOf')} {new Date(report.as_of).toLocaleDateString(t('common.locale'))}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '60px' }}>
        {/* Assets Corner */}
        <div>
          <h2 style={{ fontSize: '22px', fontWeight: '800', marginBottom: '32px', color: 'var(--blue-400)', borderBottom: '2px solid var(--blue-500)', paddingBottom: '8px' }}>
            {t('reports.assetHeader')}
          </h2>
          {report.asset_groups.map(renderSection)}
          
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            padding: '20px', 
            marginTop: '40px', 
            fontWeight: '900', 
            background: 'rgba(59, 130, 246, 0.1)', 
            borderRadius: '12px',
            border: '2px solid rgba(59, 130, 246, 0.3)',
            fontSize: '18px',
            color: 'var(--blue-400)'
          }}>
            <span>{t('reports.totalAssets')}</span>
            <span>{formatEuro(report.total_assets)}</span>
          </div>
        </div>

        {/* Liabilities & Equity Corner */}
        <div>
          <h2 style={{ fontSize: '22px', fontWeight: '800', marginBottom: '32px', color: 'var(--purple-400)', borderBottom: '2px solid var(--purple-500)', paddingBottom: '8px' }}>
            {t('reports.liabilityHeader')}
          </h2>
          {report.liability_groups.map(renderSection)}
          
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            padding: '20px', 
            marginTop: '40px', 
            fontWeight: '900', 
            background: 'rgba(168, 85, 247, 0.1)', 
            borderRadius: '12px',
            border: '2px solid rgba(168, 85, 247, 0.3)',
            fontSize: '18px',
            color: 'var(--purple-400)'
          }}>
            <span>{t('reports.totalLiabilities')}</span>
            <span>{formatEuro(report.total_liabilities)}</span>
          </div>
        </div>
      </div>

      {/* Audit Shield Seal */}
      <div style={{ 
        marginTop: '64px', 
        padding: '24px', 
        background: 'rgba(255,255,255,0.02)', 
        borderRadius: '16px', 
        border: '1px dashed var(--glass-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px'
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--green-500)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          <path d="m9 12 2 2 4-4"></path>
        </svg>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: '600' }}>
          {t('reports.balanceShield')}
        </span>
      </div>
      
      {/* Legal Footer */}
      <div style={{ marginTop: '32px', textAlign: 'center', fontSize: '10px', color: 'var(--text-secondary)', opacity: 0.4 }}>
        {t('reports.balanceFooter')}
      </div>
    </div>
  );
}
