"use client";

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { fetchWithAuth } from '@/lib/api';
import { IncomeStatement, BalanceSheet, JournalReport, GeneralLedgerReport, HousingCompany, ActivityReportRead } from '@/types';
import ReportView from '@/components/ReportView';
import TaseView from '@/components/TaseView';
import JournalView from '@/components/JournalView';
import LedgerView from '@/components/LedgerView';
import BalanceSpecification from '@/components/BalanceSpecification';
import ActivityReportEdit from '@/components/ActivityReportEdit';
import ArchiveView from '@/components/ArchiveView';
import { useCompany } from '@/context/CompanyContext';
import { useLanguage } from '@/context/LanguageContext';

export default function ReportsPage() {
  const { id } = useParams();
  const { setActiveCompany, activeCompany } = useCompany();
  const { t } = useLanguage();
  const [report, setReport] = useState<IncomeStatement | null>(null);
  const [taseReport, setTaseReport] = useState<BalanceSheet | null>(null);
  const [journalReport, setJournalReport] = useState<JournalReport | null>(null);
  const [ledgerReport, setLedgerReport] = useState<GeneralLedgerReport | null>(null);
  const [activityReport, setActivityReport] = useState<ActivityReportRead | null>(null);
  const [financialNotes, setFinancialNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'income' | 'tase' | 'journal' | 'ledger' | 'balance_spec' | 'activity_report' | 'archive'>('income');
  const [isLocked, setIsLocked] = useState(false);
  const [lockedPeriods, setLockedPeriods] = useState<any[]>([]);
  
  // Expanded Filter State
  const [filterType, setFilterType] = useState<'ALL' | 'YTD' | 'LAST_YEAR' | 'YEARLY' | 'MONTHLY'>('ALL');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);

  let sections = [];
  try {
    sections = activityReport && activityReport.content_json ? JSON.parse(activityReport.content_json).sections || [] : [];
  } catch (e) {
    console.error("Invalid activity report JSON", e);
  }

  const getPeriodDates = useCallback(() => {
    const now = new Date();
    const currYear = now.getFullYear();

    switch (filterType) {
      case 'YTD':
        return { start: `${currYear}-01-01`, end: now.toISOString().split('T')[0] };
      case 'LAST_YEAR':
        return { start: `${currYear - 1}-01-01`, end: `${currYear - 1}-12-31` };
      case 'YEARLY':
        return { start: `${selectedYear}-01-01`, end: `${selectedYear}-12-31` };
      case 'MONTHLY':
        const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
        const mm = String(selectedMonth).padStart(2, '0');
        return { start: `${selectedYear}-${mm}-01`, end: `${selectedYear}-${mm}-${lastDay}` };
      default:
        return { start: "", end: "" };
    }
  }, [filterType, selectedYear, selectedMonth]);

  const handleDeleteJob = async (jobId: number) => {
    if (!id || !confirm(t('transactions.history.rollbackConfirm'))) return;
    try {
      const res = await fetchWithAuth(`/companies/${id}/compliance/lock-period?year=${selectedYear}&month=${selectedMonth}`, { method: 'POST' });
      if (res.ok) {
        loadData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const { start, end } = getPeriodDates();
      
      const lockRes = await fetchWithAuth(`/companies/${id}/compliance/locked-periods`);
      const locks = await lockRes.json();
      setLockedPeriods(locks);
      
      if (filterType === 'MONTHLY') {
        setIsLocked(locks.some((l: any) => l.year === selectedYear && l.month === selectedMonth));
      } else {
        setIsLocked(false);
      }

      const compRes = await fetchWithAuth(`/companies/${id}`);
      const companyData = await compRes.json();
      setActiveCompany(companyData);

      const reportYear = filterType === 'MONTHLY' || filterType === 'YEARLY' ? selectedYear : new Date().getFullYear();
      
      const activityRes = await fetchWithAuth(`/companies/${id}/compliance/activity-report/${reportYear}`);
      setActivityReport(await activityRes.json());
      
      const notesRes = await fetchWithAuth(`/companies/${id}/compliance/financial-notes/${reportYear}`);
      setFinancialNotes(await notesRes.json());
      
      let queryString = "";
      if (start) queryString += `?start_date=${start}`;
      if (end) queryString += `${queryString ? '&' : '?'}end_date=${end}`;

      const repRes = await fetchWithAuth(`/companies/${id}/reports/income-statement${queryString}`);
      setReport(await repRes.json());
      
      const taseRes = await fetchWithAuth(`/companies/${id}/reports/tase${queryString}`);
      setTaseReport(await taseRes.json());

      const journalRes = await fetchWithAuth(`/companies/${id}/reports/journal${queryString}`);
      setJournalReport(await journalRes.json());

      const ledgerRes = await fetchWithAuth(`/companies/${id}/reports/general-ledger${queryString}`);
      setLedgerReport(await ledgerRes.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id, getPeriodDates, setActiveCompany, selectedYear, selectedMonth, filterType]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const downloadZIP = async () => {
    if (!id) return;
    try {
      const year = filterType === 'MONTHLY' || filterType === 'YEARLY' ? selectedYear : new Date().getFullYear();
      const res = await fetchWithAuth(`/companies/${id}/reports/yearly-archive/${year}/export-zip`);
      if (!res.ok) {
        alert("Virhe arkiston luonnissa. Varmista että vuodella on tapahtumia.");
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kirjanpito_arkisto_${year}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    }
  };

  const downloadCSV = () => {
    let csvContent = "";
    if (activeTab === 'income' && report) {
      csvContent += `${t('reports.csv.incomeTitle')}\n`;
      csvContent += `${t('reports.csv.period')}: ${report.period_start} - ${report.period_end}\n\n`;
      
      csvContent += `${t('reports.csv.revenueGroup')}\n`;
      report.revenue_groups.forEach(group => {
        csvContent += `${group.name.toUpperCase()}\n`;
        group.lines.forEach(r => csvContent += `"${r.code} - ${r.name}",${r.amount}\n`);
        csvContent += `${t('reports.csv.total')},,,${group.total}\n`;
      });
      csvContent += `"${t('reports.csv.totalRevenue')}",,,${report.total_revenue}\n\n`;
      
      csvContent += `${t('reports.csv.expenseGroup')}\n`;
      report.expense_groups.forEach(group => {
        csvContent += `${group.name.toUpperCase()}\n`;
        group.lines.forEach(r => csvContent += `"${r.code} - ${r.name}",${r.amount}\n`);
        csvContent += `${t('reports.csv.total')},,,${group.total}\n`;
      });
      csvContent += `"${t('reports.csv.totalExpenses')}",,,${report.total_expenses}\n\n`;
      
      csvContent += `"${t('reports.csv.operatingMargin')}",,,${report.operating_margin}\n\n`;

      if (report.financial_groups.length > 0) {
        csvContent += `${t('reports.csv.financialItems')}\n`;
        report.financial_groups.forEach(group => {
          csvContent += `${group.name.toUpperCase()}\n`;
          group.lines.forEach(r => csvContent += `"${r.code} - ${r.name}",${r.amount}\n`);
        });
      }
      
      csvContent += `\n"${t('reports.csv.netResult')}",,,${report.net_result}\n`;
    } else if (activeTab === 'journal' && journalReport) {
      csvContent += `PÄIVÄKIRJA\n`;
      csvContent += `Periodi: ${journalReport.period_start} - ${journalReport.period_end}\n\n`;
      csvContent += `Pvm,Tosite,Selite,Debet,Kredit\n`;
      journalReport.entries.forEach(e => {
        csvContent += `${e.date},${e.voucher_number || ""},"${e.description}",${e.amount > 0 ? e.amount : 0},${e.amount < 0 ? Math.abs(e.amount) : 0}\n`;
      });
    } else if (activeTab === 'ledger' && ledgerReport) {
      csvContent += `PÄÄKIRJA\n`;
      csvContent += `Periodi: ${ledgerReport.period_start} - ${ledgerReport.period_end}\n\n`;
      ledgerReport.accounts.forEach(acc => {
        csvContent += `\n${acc.code} ${acc.name},,Saldo: ${acc.balance}\n`;
        csvContent += `Pvm,Tosite,Selite,Debet,Kredit\n`;
        acc.items.forEach(it => {
          csvContent += `${it.date},${it.voucher_number || ""},"${it.description}",${it.amount > 0 ? it.amount : 0},${it.amount < 0 ? Math.abs(it.amount) : 0}\n`;
        });
      });
    }

    if (!csvContent) return;

    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeTab}_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div>{t('common.loading')}</div>;
  if (!report || !taseReport) return <div>{t('reports.noData')}</div>;

  const handleAccountClick = (code: string) => {
    setActiveTab('ledger');
    setTimeout(() => {
      const element = document.getElementById(`ledger-account-${code}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        element.style.outline = '2px solid var(--blue-500)';
        element.style.outlineOffset = '4px';
        setTimeout(() => { element.style.outline = 'none'; }, 2000);
      }
    }, 100);
  };

  return (
    <div>
      <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '8px' }}>{t('reports.title')}</h1>
          <p style={{ color: 'var(--text-secondary)' }}>{t('reports.subtitle')}</p>
        </div>
      </div>
      
      <div style={{ 
        marginBottom: '24px', 
        padding: '16px 24px', 
        background: isLocked ? 'rgba(34, 197, 94, 0.05)' : 'rgba(255, 255, 255, 0.02)',
        border: `1px solid ${isLocked ? 'rgba(34, 197, 94, 0.2)' : 'var(--glass-border)'}`,
        borderRadius: '12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '20px' }}>{isLocked ? '🔒' : '🔓'}</span>
          <div>
            <h4 style={{ margin: 0, fontSize: '15px', color: isLocked ? 'var(--green-400)' : 'var(--text-secondary)' }}>
              {isLocked ? t('reports.lockedTitle') : t('reports.openTitle')}
            </h4>
            <p style={{ margin: 0, fontSize: '12px', opacity: 0.6 }}>
              {isLocked 
                ? t('reports.lockedSub') 
                : t('reports.openSub')}
            </p>
          </div>
        </div>
        {filterType === 'MONTHLY' && !isLocked && (
          <button 
            onClick={() => {
              if (confirm(t('reports.lockConfirm').replace('${selectedMonth}', selectedMonth.toString()).replace('${selectedYear}', selectedYear.toString()))) {
                handleLockPeriod();
              }
            }}
            className="btn-primary"
            style={{ padding: '8px 16px', fontSize: '13px', background: 'var(--blue-500)' }}
          >
            {t('reports.lockButton')}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '32px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '2px' }}>
        <div style={{ display: 'flex', gap: '8px', background: 'var(--glass-bg)', padding: '4px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
          <button 
            onClick={() => setActiveTab('income')}
            style={{ 
              padding: '8px 16px', 
              borderRadius: '6px',
              border: 'none',
              background: activeTab === 'income' ? 'var(--blue-500)' : 'transparent',
              color: 'white',
              cursor: 'pointer',
              fontWeight: activeTab === 'income' ? '600' : '400'
            }}
          >
            {t('reports.income')}
          </button>
          <button 
            onClick={() => setActiveTab('tase')}
            style={{ 
              padding: '8px 16px', 
              borderRadius: '6px',
              border: 'none',
              background: activeTab === 'tase' ? 'var(--purple-500)' : 'transparent',
              color: 'white',
              cursor: 'pointer',
              fontWeight: activeTab === 'tase' ? '600' : '400'
            }}
          >
            {t('reports.tase')}
          </button>
          <button 
            onClick={() => setActiveTab('journal')}
            style={{ 
              padding: '8px 16px', 
              borderRadius: '6px',
              border: 'none',
              background: activeTab === 'journal' ? 'var(--orange-500)' : 'transparent',
              color: 'white',
              cursor: 'pointer',
              fontWeight: activeTab === 'journal' ? '600' : '400'
            }}
          >
            {t('reports.journal')}
          </button>
          <button 
            onClick={() => setActiveTab('ledger')}
            style={{ 
              padding: '8px 16px', 
              borderRadius: '6px',
              border: 'none',
              background: activeTab === 'ledger' ? 'var(--red-500)' : 'transparent',
              color: 'white',
              cursor: 'pointer',
              fontWeight: activeTab === 'ledger' ? '600' : '400'
            }}
          >
            {t('reports.ledger')}
          </button>
          <button 
            onClick={() => setActiveTab('balance_spec')}
            style={{ 
              padding: '8px 16px', 
              borderRadius: '6px', 
              background: activeTab === 'balance_spec' ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: activeTab === 'balance_spec' ? 'white' : 'var(--text-secondary)',
              border: 'none',
              fontSize: '13px',
              fontWeight: '600'
            }}
          >
            {t('reports.balanceSpec')}
          </button>
          <button 
            onClick={() => setActiveTab('activity_report')}
            style={{ 
              padding: '8px 16px', 
              borderRadius: '6px', 
              background: activeTab === 'activity_report' ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: activeTab === 'activity_report' ? 'white' : 'var(--text-secondary)',
              border: 'none',
              fontSize: '13px',
              fontWeight: '600'
            }}
          >
            {t('reports.activityReport')}
          </button>
          <button 
            onClick={() => setActiveTab('archive')}
            style={{ 
              padding: '8px 16px', 
              borderRadius: '6px', 
              background: activeTab === 'archive' ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: activeTab === 'archive' ? 'white' : 'var(--text-secondary)',
              border: 'none',
              fontSize: '13px',
              fontWeight: '600'
            }}
          >
            {t('reports.archive')} 📜
          </button>
        </div>

        {/* ── Lakisääteiset lisäraportit ───────────────────────────────── */}
        <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
          {[
            { href: `vastikelaskelma`, label: '📋 Vastikelaskelma', title: 'AsOyL 10:5 §' },
            { href: `double-entry`, label: '⚖️ Kahdenkertainen', title: 'KPL 2:1 §' },
            { href: `korjaukset`, label: '🔧 Korjaukset', title: 'Tehtyjen korjausten laskelma' },
            { href: `alv`, label: '🔢 ALV', title: 'ALV-raportti' },
          ].map(({ href, label, title }) => (
            <a
              key={href}
              href={`/dashboard/company/${id}/reports/${href}`}
              title={title}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid var(--glass-border)',
                background: 'var(--glass-bg)',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                fontWeight: '600',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                (e.target as HTMLElement).style.color = 'white';
                (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.3)';
              }}
              onMouseLeave={e => {
                (e.target as HTMLElement).style.color = 'var(--text-secondary)';
                (e.target as HTMLElement).style.borderColor = 'var(--glass-border)';
              }}
            >
              {label}
            </a>
          ))}
        </div>
      </div>

      
      <div style={{ marginBottom: '24px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{t('reports.time')}:</span>
          <select 
            value={filterType} 
            onChange={(e) => setFilterType(e.target.value as any)}
            style={{
              padding: '8px 12px',
              background: 'var(--glass-bg)',
              border: '1px solid var(--glass-border)',
              color: 'white',
              borderRadius: '6px',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="ALL" style={{ color: 'black' }}>{t('reports.allData')}</option>
            <option value="YTD" style={{ color: 'black' }}>{t('reports.ytd')}</option>
            <option value="LAST_YEAR" style={{ color: 'black' }}>{t('reports.lastYear')}</option>
            <option value="YEARLY" style={{ color: 'black' }}>{t('reports.selectYear')}</option>
            <option value="MONTHLY" style={{ color: 'black' }}>{t('reports.selectMonth')}</option>
          </select>
        </div>

        {(filterType === 'YEARLY' || filterType === 'MONTHLY') && (
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            style={{
              padding: '8px 12px',
              background: 'var(--glass-bg)',
              border: '1px solid var(--glass-border)',
              color: 'white',
              borderRadius: '6px',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            {[2023, 2024, 2025, 2026].map(y => (
              <option key={y} value={y} style={{ color: 'black' }}>{y}</option>
            ))}
          </select>
        )}

        {filterType === 'MONTHLY' && (
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
            style={{
              padding: '8px 12px',
              background: 'var(--glass-bg)',
              border: '1px solid var(--glass-border)',
              color: 'white',
              borderRadius: '6px',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            {t('reports.months').map((m: string, idx: number) => (
              <option key={m} value={idx + 1} style={{ color: 'black' }}>{m}</option>
            ))}
          </select>
        )}

        <button 
          onClick={downloadZIP}
          className="btn-primary"
          style={{ marginLeft: 'auto', padding: '8px 16px', display: 'flex', gap: '8px', background: 'var(--green-600)' }}
        >
          <span>📦</span> {t('reports.downloadZip') || 'Lataa Lakisääteinen ZIP-arkisto (KPL)'}
        </button>

        <button 
          onClick={downloadCSV}
          className="btn-secondary"
          style={{ padding: '8px 16px', display: 'flex', gap: '8px' }}
        >
          <span>📥</span> {t('reports.downloadCsv')}
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
        {activeTab === 'income' && report && <ReportView report={report} onAccountClick={handleAccountClick} />}
        {activeTab === 'tase' && taseReport && <TaseView report={taseReport} onAccountClick={handleAccountClick} />}
        {activeTab === 'journal' && journalReport && <JournalView report={journalReport} />}
        {activeTab === 'ledger' && ledgerReport && <LedgerView report={ledgerReport} />}
        {activeTab === 'balance_spec' && ledgerReport && <BalanceSpecification report={ledgerReport} />}
        
        {activeTab === 'activity_report' && id && (
          <ActivityReportEdit companyId={Number(id)} year={selectedYear} />
        )}

        {activeTab === 'archive' && activeCompany && report && taseReport && journalReport && ledgerReport && (
          <ArchiveView 
            companyId={Number(id)}
            companyName={activeCompany.name}
            year={selectedYear}
            income={report}
            balance={taseReport}
            journal={journalReport}
            ledger={ledgerReport}
            activityReport={activityReport}
            financialNotes={financialNotes}
          />
        )}
      </div>

    </div>
  );
}
