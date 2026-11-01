import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileText, TrendingUp, DollarSign, Download, Calendar } from 'lucide-react';
import { getIncomeStatement, getBalanceSheet } from '../api/reports';
import { getCompanies } from '../api/companies';

const ReportSection = ({ title, data, type }: { title: string, data: any, type: 'income' | 'balance' }) => {
  if (!data) return null;

  const renderAccounts = (accounts: Record<string, number>) => {
    return Object.entries(accounts).map(([acc, amount]) => (
      <div key={acc} className="flex justify-between py-2 border-b border-white/5 text-sm">
        <span className="text-slate-400">{acc}</span>
        <span className="font-mono">{amount.toLocaleString('fi-FI', { minimumFractionDigits: 2 })} €</span>
      </div>
    ));
  };

  return (
    <div className="glass-card p-6 space-y-4">
      <h3 className="text-lg font-bold flex items-center space-x-2">
        <FileText className="w-5 h-5 text-primary-400" />
        <span>{title}</span>
      </h3>
      
      <div className="space-y-6">
        {type === 'income' ? (
          <>
            <div>
              <h4 className="text-xs uppercase font-bold text-slate-500 mb-2">Tuotot</h4>
              {renderAccounts(data.revenue.accounts)}
              <div className="flex justify-between py-2 font-bold text-emerald-400">
                <span>Yhteensä Tuotot</span>
                <span>{data.revenue.total.toLocaleString('fi-FI')} €</span>
              </div>
            </div>
            <div>
              <h4 className="text-xs uppercase font-bold text-slate-500 mb-2">Kulut</h4>
              {renderAccounts(data.expenses.accounts)}
              <div className="flex justify-between py-2 font-bold text-red-400">
                <span>Yhteensä Kulut</span>
                <span>{data.expenses.total.toLocaleString('fi-FI')} €</span>
              </div>
            </div>
            <div className="pt-4 border-t border-white/10 flex justify-between text-xl font-bold">
              <span>Tilikauden tulos</span>
              <span className={data.netProfit >= 0 ? 'text-emerald-500' : 'text-red-500'}>
                {data.netProfit.toLocaleString('fi-FI')} €
              </span>
            </div>
          </>
        ) : (
          <>
            <div>
              <h4 className="text-xs uppercase font-bold text-slate-500 mb-2">Vastaavaa (Varat)</h4>
              {renderAccounts(data.assets.accounts)}
              <div className="flex justify-between py-2 font-bold text-white">
                <span>Vastaavaa Yhteensä</span>
                <span>{data.assets.total.toLocaleString('fi-FI')} €</span>
              </div>
            </div>
            <div>
              <h4 className="text-xs uppercase font-bold text-slate-500 mb-2">Vastattavaa (Velat & Oma pääoma)</h4>
              {renderAccounts(data.equity.accounts)}
              <div className="flex justify-between py-2 font-bold text-white">
                <span>Vastattavaa Yhteensä</span>
                <span>{data.equity.total.toLocaleString('fi-FI')} €</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const ReportsPage = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'income' | 'balance'>('income');

  const { data: companies } = useQuery({ queryKey: ['companies'], queryFn: getCompanies });
  const selectedCompany = companies?.[0];

  const { data: incomeData, isLoading: incomeLoading } = useQuery({
    queryKey: ['income-statement', selectedCompany?.id],
    queryFn: () => getIncomeStatement(selectedCompany?.id),
    enabled: !!selectedCompany?.id && activeTab === 'income',
  });

  const { data: balanceData, isLoading: balanceLoading } = useQuery({
    queryKey: ['balance-sheet', selectedCompany?.id],
    queryFn: () => getBalanceSheet(selectedCompany?.id),
    enabled: !!selectedCompany?.id && activeTab === 'balance',
  });

  const isLoading = incomeLoading || balanceLoading;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{t('reports.title')}</h2>
          <p className="text-slate-400 mt-1">Seuraa taloyhtiön taloudellista tilaa tuloslaskelman ja taseen avulla.</p>
        </div>
        <div className="flex space-x-2">
          <button className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white flex items-center space-x-2 text-sm font-semibold transition-all">
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

      <div className="grid grid-cols-1 gap-8">
        {isLoading ? (
          <div className="glass-card p-12 flex flex-col items-center justify-center space-y-4">
            <div className="w-10 h-10 border-4 border-primary-500/20 border-t-primary-500 rounded-full animate-spin" />
            <p className="text-slate-400 font-medium">Ladataan raporttia...</p>
          </div>
        ) : (
          <ReportSection 
            title={activeTab === 'income' ? t('reports.incomeStatement') : t('reports.balanceSheet')} 
            data={activeTab === 'income' ? incomeData : balanceData}
            type={activeTab}
          />
        )}
      </div>
    </div>
  );
};

export default ReportsPage;
