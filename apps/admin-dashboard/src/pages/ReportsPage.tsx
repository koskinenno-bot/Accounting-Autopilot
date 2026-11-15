import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileText, Download, AlertCircle } from 'lucide-react';
import { getIncomeStatement, getBalanceSheet, openReportPdf } from '../api/reports';
import { useCompany } from '../hooks/useCompany';
import FiscalYearSelect from '../components/FiscalYearSelect';

const eur = (n: number) => `${n.toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

interface Row { account: string; label: string; amount: number; previous?: number }
interface Section {
  title: string; rows?: Row[]; total: number; previousTotal?: number; subtotal?: boolean;
  groups?: { title: string; rows: Row[]; total: number; previousTotal?: number }[];
}
interface FiscalYear { startDate: string; endDate: string }

const yearLabel = (fy?: FiscalYear | null) =>
  fy ? `${new Date(fy.startDate).toLocaleDateString('fi-FI')}–${new Date(fy.endDate).toLocaleDateString('fi-FI')}` : '';

/** Rivi: selite ja summat. Vertailuvuoden sarake näkyy, kun edellinen tilikausi on olemassa. */
const Line = ({ label, amount, previous, cmp, className = '', labelClass = 'text-slate-400' }: {
  label: string; amount: number; previous?: number; cmp: boolean; className?: string; labelClass?: string;
}) => (
  <div className={`grid ${cmp ? 'grid-cols-[1fr_8rem_8rem]' : 'grid-cols-[1fr_8rem]'} gap-2 py-1.5 text-sm ${className}`}>
    <span className={labelClass}>{label}</span>
    <span className="font-mono text-right">{eur(amount)}</span>
    {cmp && <span className="font-mono text-right text-slate-500">{previous === undefined ? '' : eur(previous)}</span>}
  </div>
);

/** Taloyhtiön kaavan mukainen osio: otsikko, erittelyryhmät tai tilirivit ja välisumma. */
const SectionBlock = ({ section, cmp }: { section: Section; cmp: boolean }) => {
  if (section.subtotal) {
    return (
      <div className={`grid ${cmp ? 'grid-cols-[1fr_8rem_8rem]' : 'grid-cols-[1fr_8rem]'} gap-2 py-3 border-t border-white/10 font-bold`}>
        <span className="uppercase text-sm tracking-wide">{section.title}</span>
        <span className={`text-right ${section.total < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{eur(section.total)}</span>
        {cmp && <span className="text-right text-slate-500">{section.previousTotal === undefined ? '' : eur(section.previousTotal)}</span>}
      </div>
    );
  }
  return (
    <div>
      <h4 className="text-xs uppercase font-bold text-slate-500 mt-3 mb-1">{section.title}</h4>
      {section.groups?.length
        ? section.groups.map((g) => (
          <div key={g.title} className="border-b border-white/5">
            <Line label={g.title} amount={g.total} previous={g.previousTotal} cmp={cmp} labelClass="text-slate-200" />
            {/* Ryhmän tilit näytetään, kun ryhmässä on useampi tili tai tilin nimi poikkeaa ryhmästä */}
            {(g.rows.length > 1 || !g.rows[0]?.label.endsWith(g.title)) && g.rows.map((r) => (
              <Line key={r.label} label={r.label} amount={r.amount} previous={r.previous} cmp={cmp}
                className="pl-4 py-1 text-xs" labelClass="text-slate-500" />
            ))}
          </div>
        ))
        : (section.rows || []).map((r) => (
          <Line key={r.label} label={r.label} amount={r.amount} previous={r.previous} cmp={cmp} className="border-b border-white/5" />
        ))}
      <Line label={`${section.title} yhteensä`} amount={section.total} previous={section.previousTotal} cmp={cmp}
        className="font-semibold" labelClass="" />
    </div>
  );
};

const YearHeader = ({ fy, prev }: { fy?: FiscalYear | null; prev?: FiscalYear | null }) => (
  <div className={`grid ${prev ? 'grid-cols-[1fr_8rem_8rem]' : 'grid-cols-[1fr_8rem]'} gap-2 text-xs text-slate-500 border-b border-white/10 pb-1`}>
    <span />
    <span className="text-right">{yearLabel(fy)}</span>
    {prev && <span className="text-right">{yearLabel(prev)}</span>}
  </div>
);

const ReportsPage = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'income' | 'balance'>('income');
  const [fiscalYearId, setFiscalYearId] = useState<string>();
  const [pdfError, setPdfError] = useState<string | null>(null);

  const { selectedCompany } = useCompany();
  const companyId: string | undefined = selectedCompany?.id;

  const { data: incomeData, isLoading: incomeLoading } = useQuery({
    queryKey: ['income-statement', companyId, fiscalYearId],
    queryFn: () => getIncomeStatement(companyId as string, fiscalYearId),
    enabled: !!companyId && !!fiscalYearId && activeTab === 'income',
  });

  const { data: balanceData, isLoading: balanceLoading } = useQuery({
    queryKey: ['balance-sheet', companyId, fiscalYearId],
    queryFn: () => getBalanceSheet(companyId as string, fiscalYearId),
    enabled: !!companyId && !!fiscalYearId && activeTab === 'balance',
  });

  const isLoading = incomeLoading || balanceLoading;
  const data = activeTab === 'income' ? incomeData : balanceData;

  const downloadPdf = () => {
    if (!companyId) return;
    setPdfError(null);
    openReportPdf(companyId, activeTab === 'income' ? 'income-statement' : 'balance-sheet', fiscalYearId)
      .catch(() => setPdfError('PDF:n luonti epäonnistui'));
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{t('reports.title')}</h2>
          <p className="text-slate-400 mt-1">Tuloslaskelma ja tase taloyhtiön kaavan mukaan vertailuvuoden kanssa (vain hyväksytyt viennit).</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FiscalYearSelect companyId={companyId} value={fiscalYearId} onChange={setFiscalYearId} />
          <button
            type="button"
            onClick={downloadPdf}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white flex items-center space-x-2 text-sm font-semibold transition-all"
          >
            <Download className="w-4 h-4" />
            <span>PDF</span>
          </button>
          <div className="flex bg-slate-900/50 p-1 rounded-xl border border-white/5">
            <button
              onClick={() => setActiveTab('income')}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'income' ? 'bg-primary-500 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {t('reports.incomeStatement')}
            </button>
            <button
              onClick={() => setActiveTab('balance')}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'balance' ? 'bg-primary-500 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {t('reports.balanceSheet')}
            </button>
          </div>
        </div>
      </div>
      {pdfError && <div className="text-sm text-rose-300">{pdfError}</div>}

      {isLoading || !data ? (
        <div className="glass-card p-12 flex flex-col items-center justify-center space-y-4">
          <div className="w-10 h-10 border-4 border-primary-500/20 border-t-primary-500 rounded-full animate-spin" />
          <p className="text-slate-400 font-medium">Ladataan raporttia...</p>
        </div>
      ) : (
        <div className="glass-card p-6 space-y-2">
          <h3 className="text-lg font-bold flex items-center space-x-2 mb-2">
            <FileText className="w-5 h-5 text-primary-400" />
            <span>{activeTab === 'income' ? t('reports.incomeStatement') : t('reports.balanceSheet')}</span>
          </h3>
          {activeTab === 'income'
            ? (
              <div>
                <YearHeader fy={data.fiscalYear} prev={data.previousFiscalYear} />
                {(data.sections as Section[]).map((s) => <SectionBlock key={s.title} section={s} cmp={!!data.previousFiscalYear} />)}
              </div>
            )
            : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {(['assets', 'liabilities'] as const).map((side) => (
                  <div key={side}>
                    <h4 className="font-bold mb-1">{side === 'assets' ? 'VASTAAVAA' : 'VASTATTAVAA'}</h4>
                    <YearHeader fy={data.fiscalYear} prev={data.previousFiscalYear} />
                    {(data.sections[side] as Section[]).map((s) => <SectionBlock key={s.title} section={s} cmp={!!data.previousFiscalYear} />)}
                    <Line
                      label={side === 'assets' ? 'Vastaavaa yhteensä' : 'Vastattavaa yhteensä'}
                      amount={side === 'assets' ? data.assets.total : data.equity.total}
                      previous={data.previousFiscalYear
                        ? (data.sections[side] as Section[]).reduce((sum, s) => sum + (s.previousTotal ?? 0), 0)
                        : undefined}
                      cmp={!!data.previousFiscalYear}
                      className="py-3 border-t border-white/10 font-bold text-base"
                      labelClass=""
                    />
                  </div>
                ))}
                {!data.balanced && (
                  <div className="flex items-center gap-2 text-rose-300 text-sm"><AlertCircle className="w-4 h-4" />Tase ei täsmää</div>
                )}
              </div>
            )}
        </div>
      )}
    </div>
  );
};

export default ReportsPage;
