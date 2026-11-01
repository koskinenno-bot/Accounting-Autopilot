import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getMaintenanceCalculation, openReportPdf } from '../api/reports';
import { getCompanies } from '../api/companies';
import FiscalYearSelect from '../components/FiscalYearSelect';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Calculator, TrendingUp, TrendingDown, ArrowRightLeft } from 'lucide-react';

const VastikeReportPage: React.FC = () => {
  const { t } = useTranslation();
  // Sama valinta kuin ReportsPagella: käyttäjän ensimmäinen yhtiö
  // (aiemmin kovakoodattu 'test-company-id' => raportti näytti aina nollia).
  const { data: companies, isLoading: companiesLoading } = useQuery({ queryKey: ['companies'], queryFn: getCompanies });
  const companyId: string | undefined = companies?.[0]?.id;
  const [fiscalYearId, setFiscalYearId] = useState<string>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['maintenanceCalculation', companyId, fiscalYearId],
    queryFn: () => getMaintenanceCalculation(companyId as string, fiscalYearId),
    enabled: !!companyId && !!fiscalYearId,
  });

  if (!companiesLoading && !companyId) return <div className="p-8 text-center text-slate-400">Ei yhtiötä. Lisää yhtiö Yhtiöt-sivulla.</div>;
  if (companiesLoading || !fiscalYearId || isLoading) {
    return (
      <div className="p-8 text-center">
        {t('common.loading')}
        {/* valitsin hakee tilikaudet ja asettaa oletuksen */}
        <div className="hidden"><FiscalYearSelect companyId={companyId} value={fiscalYearId} onChange={setFiscalYearId} /></div>
      </div>
    );
  }
  if (error || !data) return <div className="p-8 text-center text-red-500">Virhe raportin latauksessa</div>;

  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' }).format(amount);

  const FundCard = ({ title, fundData, icon: Icon }: any) => {
    const isSurplus = fundData.surplus >= 0;
    
    return (
      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b">
          <CardTitle className="text-xl font-semibold">{title}</CardTitle>
          <Icon className="h-6 w-6 text-indigo-500" />
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-dashed">
              <span className="text-gray-600">{t('reports.income')}</span>
              <span className="font-bold text-green-600 text-lg">{formatCurrency(fundData.income)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-dashed">
              <span className="text-gray-600">{t('reports.expenses')}</span>
              <span className="font-bold text-red-600 text-lg">{formatCurrency(fundData.expenses)}</span>
            </div>
            <div className="flex justify-between items-center pt-4">
              <span className="text-lg font-bold">{t('reports.surplus')}</span>
              <div className={`flex items-center gap-2 text-xl font-extrabold ${isSurplus ? 'text-green-700' : 'text-red-700'}`}>
                {isSurplus ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                {formatCurrency(fundData.surplus)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <div className="p-3 bg-indigo-100 rounded-lg">
          <ArrowRightLeft className="h-8 w-8 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t('reports.vastikelaskelma')}</h1>
          <p className="text-gray-500">Tilikauden rahastokohtainen toteuma ja ylijäämäseuranta</p>
        </div>
        <div className="ml-auto flex gap-2">
          <FiscalYearSelect companyId={companyId} value={fiscalYearId} onChange={setFiscalYearId} />
          <button
            type="button"
            onClick={() => openReportPdf(companyId as string, 'maintenance-calculation', fiscalYearId).catch(() => window.alert('PDF:n luonti epäonnistui'))}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white flex items-center gap-2 text-sm font-semibold"
          >
            <Download className="w-4 h-4" />PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <FundCard 
          title={t('reports.maintenanceFund')} 
          fundData={data.maintenance_fund} 
          icon={Calculator}
        />
        <FundCard 
          title={t('reports.capitalFund')} 
          fundData={data.capital_fund} 
          icon={TrendingUp}
        />
      </div>

      <Card className="mt-8 bg-indigo-50 border-indigo-100">
        <CardContent className="p-6">
          <h3 className="font-bold text-indigo-900 mb-2">Huomioita raportista</h3>
          <ul className="list-disc list-inside text-indigo-800 space-y-1 text-sm">
            <li>Luvut sisältävät arvonlisäveron (taloyhtiön bruttoperiaate).</li>
            <li>Pääomarahoituslaskelma sisältää hanke- ja rahoitusvastikkeet sekä niihin kohdistuvat rahoituskulut.</li>
            <li>Ylijäämää/alijäämää verrataan tilikauden päättävään taseeseen.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};

export default VastikeReportPage;
