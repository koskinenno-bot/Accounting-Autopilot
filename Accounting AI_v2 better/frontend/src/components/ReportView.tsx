"use client";

import { useLanguage } from '@/context/LanguageContext';
import { IncomeStatement, ReportSection, ReportLine } from '@/types';

export default function ReportView({ report, onAccountClick }: { report: IncomeStatement, onAccountClick?: (code: string) => void }) {
  const { t } = useLanguage();
  
  const formatEuro = (amount: number) => {
    return `€${amount.toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getVarianceColor = (line: ReportLine, isRevenue: boolean) => {
    if (line.budget_amount === 0) return 'var(--text-secondary)';
    if (isRevenue) {
      return line.variance >= 0 ? 'var(--green-400)' : 'var(--red-400)';
    } else {
      // For expenses, if actual > budget (variance > 0), it's bad
      return line.variance <= 0 ? 'var(--green-400)' : 'var(--red-400)';
    }
  };

  const renderSection = (section: ReportSection, isRevenue: boolean) => (
    <div key={section.name} style={{ marginBottom: '24px' }}>
      <div style={{ 
        fontSize: '13px', 
        fontWeight: '700', 
        color: 'var(--text-secondary)', 
        textTransform: 'uppercase', 
        marginBottom: '12px', 
        paddingLeft: '4px',
        letterSpacing: '0.05em'
      }}>
        {section.name}
      </div>
      
      {/* Table Headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px 100px', padding: '0 12px 8px 12px', fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
        <span>{t('reports.table.description')}</span>
        <span style={{ textAlign: 'right' }}>{t('reports.actual')}</span>
        <span style={{ textAlign: 'right' }}>{t('reports.budget')}</span>
        <span style={{ textAlign: 'right' }}>{t('reports.variance')}</span>
      </div>

      {section.lines.map(line => (
        <div key={line.code} 
          onClick={() => onAccountClick && onAccountClick(line.code)}
          style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 100px 100px 100px',
            padding: '10px 12px', 
            borderBottom: '1px solid rgba(255,255,255,0.03)',
            transition: 'background 0.2s, transform 0.1s',
            alignItems: 'center',
            cursor: onAccountClick ? 'pointer' : 'default'
          }}
          onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
          onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.995)'}
          onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          <span style={{ fontSize: '14px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ opacity: 0.5, marginRight: '8px', fontFamily: 'monospace', fontSize: '12px' }}>{line.code}</span>
            {line.name}
          </span>
          <span style={{ fontWeight: '600', textAlign: 'right', fontFamily: 'monospace' }}>{formatEuro(line.amount)}</span>
          <span style={{ fontSize: '13px', textAlign: 'right', opacity: 0.6, fontFamily: 'monospace' }}>{formatEuro(line.budget_amount)}</span>
          <span style={{ fontSize: '13px', fontWeight: '700', textAlign: 'right', fontFamily: 'monospace', color: getVarianceColor(line, isRevenue) }}>
            {line.variance > 0 ? '+' : ''}{formatEuro(line.variance)}
          </span>
        </div>
      ))}
      
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr 100px 100px 100px',
        padding: '12px 12px', 
        fontWeight: '800', 
        fontSize: '14px',
        color: 'var(--text-primary)',
        marginTop: '2px',
        background: 'rgba(255,255,255,0.01)'
      }}>
        <span>{t('reports.total')} {section.name.toUpperCase()}</span>
        <span style={{ textAlign: 'right', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '4px' }}>{formatEuro(section.total)}</span>
        <span style={{ textAlign: 'right', opacity: 0.5, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '4px' }}>
          {formatEuro(section.lines.reduce((acc, l) => acc + l.budget_amount, 0))}
        </span>
        <span style={{ textAlign: 'right', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '4px' }}>
          {formatEuro(section.lines.reduce((acc, l) => acc + l.variance, 0))}
        </span>
      </div>
    </div>
  );

  return (
    <div className="card-glass" style={{ padding: '40px', maxWidth: '850px', margin: '0 auto', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '48px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '800', marginBottom: '8px', letterSpacing: '-0.02em' }}>{t('reports.income')}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '16px' }}>
          {new Date(report.period_start).toLocaleDateString(t('common.locale'))} – {new Date(report.period_end).toLocaleDateString(t('common.locale'))}
        </p>
      </div>

      {/* Revenue Sections */}
      <div style={{ marginBottom: '48px' }}>
        <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '24px', color: 'var(--green-400)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--green-500)' }}></div>
          {t('reports.revenueHeader')}
        </h3>
        {report.revenue_groups.map(g => renderSection(g, true))}
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 300px',
          padding: '20px', 
          marginTop: '12px', 
          fontWeight: '900', 
          background: 'rgba(34, 197, 94, 0.08)', 
          borderRadius: '8px',
          border: '1px solid rgba(34, 197, 94, 0.2)',
          fontSize: '16px'
        }}>
          <span>{t('reports.revenueTotal')}</span>
          <span style={{ textAlign: 'right' }}>{formatEuro(report.total_revenue)}</span>
        </div>
      </div>

      {/* Expense Sections */}
      <div style={{ marginBottom: '48px' }}>
        <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '24px', color: 'var(--red-400)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--red-500)' }}></div>
          {t('reports.expenseHeader')}
        </h3>
        {report.expense_groups.map(g => renderSection(g, false))}
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 300px',
          padding: '20px', 
          marginTop: '12px', 
          fontWeight: '900', 
          background: 'rgba(239, 68, 68, 0.08)', 
          borderRadius: '8px',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          fontSize: '16px'
        }}>
          <span>{t('reports.expenseTotal')}</span>
          <span style={{ textAlign: 'right' }}>{formatEuro(report.total_expenses)}</span>
        </div>
      </div>

      {/* Operating Margin (Hoitokate) */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        padding: '24px', 
        background: 'rgba(255, 255, 255, 0.03)', 
        borderRadius: '12px', 
        border: '2px solid var(--glass-border)',
        marginBottom: '48px',
        boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.2)'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '20px', fontWeight: '800' }}>{t('reports.operatingMargin')}</span>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Operating Margin</span>
        </div>
        <span style={{ fontSize: '24px', fontWeight: '800', color: report.operating_margin >= 0 ? 'var(--green-400)' : 'var(--red-400)' }}>
          {formatEuro(report.operating_margin)}
        </span>
      </div>

      {/* Financial Items */}
      {report.financial_groups.length > 0 && (
        <div style={{ marginBottom: '48px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px', color: 'var(--blue-400)', opacity: 0.8 }}>{t('reports.financialItems')}</h3>
          {report.financial_groups.map(g => renderSection(g, true))}
        </div>
      )}

      {/* Net Result */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        padding: '30px', 
        background: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%)', 
        borderRadius: '16px', 
        border: '1px solid var(--glass-border)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.2)'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '24px', fontWeight: '900', letterSpacing: '-0.02em' }}>{t('reports.netResult')}</span>
          <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: '500' }}>NET RESULT</span>
        </div>
        <span style={{ fontSize: '32px', fontWeight: '900', color: report.net_result >= 0 ? 'var(--green-500)' : 'var(--red-500)', textShadow: '0 0 20px rgba(34, 197, 94, 0.2)' }}>
          {formatEuro(report.net_result)}
        </span>
      </div>
      
      {/* Footer / Meta */}
      <div style={{ marginTop: '48px', textAlign: 'center', fontSize: '11px', color: 'var(--text-secondary)', opacity: 0.5 }}>
        {t('reports.footer')}
      </div>
    </div>
  );
}
