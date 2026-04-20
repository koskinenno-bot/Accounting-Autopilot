import { IncomeStatement, BalanceSheet, JournalReport, GeneralLedgerReport, ActivityReportRead, FinancialNote } from '@/types';
import ReportView from './ReportView';
import TaseView from './TaseView';
import JournalView from './JournalView';
import LedgerView from './LedgerView';
import BalanceSpecification from './BalanceSpecification';
import { fetchWithAuth } from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';

interface ArchiveViewProps {
  companyId: number;
  companyName: string;
  year: number;
  income: IncomeStatement;
  balance: BalanceSheet;
  journal: JournalReport;
  ledger: GeneralLedgerReport;
  activityReport?: ActivityReportRead | null;
  financialNotes: FinancialNote[];
}

export default function ArchiveView({ companyId, companyName, year, income, balance, journal, ledger, activityReport, financialNotes }: ArchiveViewProps) {
  const { t } = useLanguage();
  let sections = [];
  try {
    sections = activityReport && activityReport.content_json ? JSON.parse(activityReport.content_json).sections || [] : [];
  } catch (e) {
    console.error("Invalid activity report JSON", e);
  }

  const handleExport = async () => {
    try {
      const res = await fetchWithAuth(`/companies/${companyId}/compliance/export-archive/${year}`);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `arkisto_${companyName.replace(/\s+/g, '_')}_${year}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(t('reports.archiveMain.fail'));
    }
  };

  return (
    <div className="printable-archive" style={{ color: 'black', background: 'white', padding: '40px' }}>
      <div className="no-print" style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginBottom: '40px' }}>
        <button onClick={() => window.print()} className="btn-primary">{t('reports.archiveMain.printPdf')}</button>
        <button onClick={handleExport} className="btn-secondary">{t('reports.archiveMain.exportJson')}</button>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
          body { background: white !important; color: black !important; }
          .card-glass { border: none !important; background: transparent !important; color: black !important; }
        }
      `}</style>

      <div style={{ textAlign: 'center', marginBottom: '60px' }}>
        <h1 style={{ fontSize: '32px', marginBottom: '8px' }}>{t('reports.archiveMain.title')}</h1>
        <h2 style={{ fontSize: '24px', opacity: 0.8 }}>{companyName}</h2>
        <h3 style={{ fontSize: '20px', opacity: 0.6 }}>{t('reports.archiveMain.period')}: 1.1.{year} - 31.12.{year}</h3>
      </div>

      <div className="archive-section">
        <h2 style={{ borderBottom: '2px solid black', paddingBottom: '8px' }}>{t('reports.archiveMain.s1')}</h2>
        {sections.length > 0 ? sections.map((s: any, i: number) => (
          <div key={i} style={{ marginBottom: '24px' }}>
            <h4 style={{ marginBottom: '4px', textTransform: 'uppercase' }}>{s.title}</h4>
            <p style={{ lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{s.body}</p>
          </div>
        )) : <p>{t('reports.archiveMain.s1Empty')}</p>}
      </div>

      <div className="archive-section">
        <h2 style={{ borderBottom: '2px solid black', paddingBottom: '8px' }}>{t('reports.archiveMain.s2')}</h2>
        {financialNotes.length > 0 ? financialNotes.map((n, i) => (
          <div key={i} style={{ marginBottom: '20px' }}>
            <h4 style={{ marginBottom: '4px', textTransform: 'uppercase', color: '#444' }}>{n.note_type}</h4>
            <div style={{ lineHeight: '1.5', whiteSpace: 'pre-wrap', fontSize: '14px' }}>{n.content}</div>
          </div>
        )) : <p>{t('reports.archiveMain.s2Empty')}</p>}
      </div>

      <div className="page-break"></div>
      <div className="archive-section">
        <h2 style={{ borderBottom: '2px solid black', paddingBottom: '8px' }}>{t('reports.archiveMain.s3')}</h2>
        <ReportView report={income} />
      </div>

      <div className="page-break"></div>
      <div className="archive-section">
        <h2 style={{ borderBottom: '2px solid black', paddingBottom: '8px' }}>{t('reports.archiveMain.s4')}</h2>
        <TaseView report={balance} />
      </div>

      <div className="page-break"></div>
      <div className="archive-section">
        <h2 style={{ borderBottom: '2px solid black', paddingBottom: '8px' }}>{t('reports.archiveMain.s5')}</h2>
        <BalanceSpecification report={ledger} />
      </div>

      <div className="page-break"></div>
      <div className="archive-section">
        <h2 style={{ borderBottom: '2px solid black', paddingBottom: '8px' }}>{t('reports.archiveMain.s6')}</h2>
        <JournalView report={journal} />
      </div>

      <div className="page-break"></div>
      <div className="archive-section">
        <h2 style={{ borderBottom: '2px solid black', paddingBottom: '8px' }}>{t('reports.archiveMain.s7')}</h2>
        <LedgerView report={ledger} />
      </div>

      <div style={{ marginTop: '100px', borderTop: '1px solid #ccc', paddingTop: '20px', fontSize: '12px', textAlign: 'center' }}>
        {t('reports.archiveMain.footer')}<br />
        {t('reports.archiveMain.printedAt')}: {new Date().toLocaleDateString(t('common.locale'))} klo {new Date().toLocaleTimeString(t('common.locale'))}
      </div>
    </div>
  );
}
