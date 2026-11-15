import { Activity, Users, FileCheck, AlertCircle, ArrowUpRight, Upload, CreditCard, Brain } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { getLedger, getAccountingStats } from '../api/accounting';
import { getCompanyStats } from '../api/companies';
import { useCompany } from '../hooks/useCompany';
import { useAuth } from '../hooks/useAuth';
import TimeCard from '../components/TimeCard';
import MissingVouchersCard from '../components/MissingVouchersCard';
import CompanyInfoCard from '../components/CompanyInfoCard';
import { uploadVoucher } from '../api/vouchers';
import { uploadStatement } from '../api/bank';
import { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const ML_SERVICE_URL = import.meta.env.VITE_ML_SERVICE_URL || import.meta.env.VITE_API_URL || 'http://localhost:8001/api/v1';

// Aiemmat muutosluvut (+1, -2 ...) olivat kovakoodattuja eivätkä perustuneet dataan, joten ne poistettiin.
// to: kortti on linkki (esim. Käsittelemättömät -> /pending).
const StatCard = ({ title, value, icon: Icon, to, hint }: { title: string, value: string, icon: any, to?: string, hint?: string }) => {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <div className="w-12 h-12 bg-primary-500/10 rounded-xl flex items-center justify-center">
          <Icon className="w-6 h-6 text-primary-400" />
        </div>
        {to && hint && (
          <div className="flex items-center space-x-1 text-sm text-primary-400 opacity-70 group-hover:opacity-100">
            <span>{hint}</span>
            <ArrowUpRight className="w-4 h-4" />
          </div>
        )}
      </div>
      <div>
        <h3 className="text-slate-400 text-sm font-medium">{title}</h3>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </div>
    </>
  );
  return to ? (
    <Link to={to} className="glass-card p-6 flex flex-col space-y-4 group cursor-pointer hover:border-primary-500/40 hover:bg-white/[0.03] transition-colors">
      {body}
    </Link>
  ) : (
    <div className="glass-card p-6 flex flex-col space-y-4">{body}</div>
  );
};

const SuggestionBadge = ({ accountCode, label, confidence }: { accountCode: string, label: string, confidence: number }) => (
  <div className="flex items-center space-x-2 bg-primary-500/5 border border-primary-500/20 rounded-lg px-2 py-1 group/suggestion cursor-help" title={`Luottamusarvo: ${(confidence * 100).toFixed(0)}%`}>
    <Brain className="w-3.5 h-3.5 text-primary-400" />
    <span className="text-[10px] font-bold text-primary-300">{accountCode}</span>
    <span className="text-[10px] text-primary-400/70 truncate max-w-[80px]">{label}</span>
  </div>
);

/** Yhden prosessin palvelimessa (VITE_API_URL) tila haetaan palvelimen omasta /health-osoitteesta. */
const SINGLE_SERVER: string | undefined = import.meta.env.VITE_API_URL
  ? String(import.meta.env.VITE_API_URL).replace(/\/api\/v1\/?$/, '')
  : undefined;

const ServiceStatus = ({ name, url }: { name: string, url: string }) => {
  const [status, setStatus] = useState<'loading' | 'online' | 'offline'>('loading');
  const [uptime, setUptime] = useState(100);

  useEffect(() => {
    const check = async () => {
      try {
        await axios.get(`${url}/health`, { timeout: 3000 });
        setStatus('online');
        setUptime(99.9);
      } catch (e) {
        setStatus('offline');
        setUptime(0);
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [url]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-400">{name}</span>
        <span className={`${status === 'online' ? 'text-emerald-400' : status === 'offline' ? 'text-rose-400' : 'text-slate-500'} flex items-center space-x-1`}>
          <div className={`w-1.5 h-1.5 rounded-full ${status === 'online' ? 'bg-emerald-400 animate-pulse' : status === 'offline' ? 'bg-rose-400' : 'bg-slate-700'}`} />
          <span className="capitalize">{status}</span>
        </span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${uptime}%` }}
          className={`h-full ${status === 'online' ? 'premium-gradient' : 'bg-rose-500/50'}`} 
        />
      </div>
    </div>
  );
};


const Dashboard = () => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bankInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { selectedCompany, canWrite, canManage } = useCompany();
  const { user } = useAuth();
  const { data: companyStats } = useQuery({ queryKey: ['companyStats'], queryFn: getCompanyStats });
  
  const { data: accStats } = useQuery({
    queryKey: ['accStats', selectedCompany?.id],
    queryFn: () => getAccountingStats(selectedCompany?.id),
    enabled: !!selectedCompany?.id
  });

  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: ['ledger', selectedCompany?.id],
    queryFn: async () => {
      const data = await getLedger(selectedCompany!.id);
      // For unposted entries, fetch ML suggestions
      return Promise.all(
        data.map(async (entry: any) => {
          if (entry.status !== 'POSTED') {
            try {
              const { data: mlData } = await axios.post(`${ML_SERVICE_URL}/ml/classify-transaction`, {
                description: entry.lines[0]?.description || entry.voucherNumber,
                amount: entry.lines[0]?.debit || 0,
                date: entry.entryDate
              });
              return { ...entry, suggestion: mlData };
            } catch (e) {
              return entry;
            }
          }
          return entry;
        })
      );
    },
    enabled: !!selectedCompany?.id,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadVoucher(file, selectedCompany!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger'] });
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      alert('Tosite ladattu. Tiedot luetaan taustalla, ja kirjausluonnos ilmestyy Käsittelemättömiin hetken kuluttua.');
    },
    onError: () => alert('Lataus epäonnistui.'),
  });

  const bankMutation = useMutation({
    mutationFn: (file: File) => uploadStatement(file, selectedCompany!.id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['ledger'] });
      queryClient.invalidateQueries({ queryKey: ['accStats'] });
      alert(`${t('bank.success')} ${data.results.matchedInvoices}`);
    },
    onError: () => alert(t('bank.error')),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && selectedCompany) {
      uploadMutation.mutate(file);
    }
  };

  const handleBankChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && selectedCompany) {
      bankMutation.mutate(file);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Hallintapaneeli</h2>
          <p className="text-slate-400 mt-1">Yhteenveto tilanteesta ja automaation tilasta.</p>
        </div>
        {canWrite && <div className="flex items-center space-x-3">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            className="hidden" 
            accept="image/*,application/pdf"
          />
          <input 
            type="file" 
            ref={bankInputRef} 
            onChange={handleBankChange} 
            className="hidden" 
            accept="application/xml,text/xml,.xml,text/csv,.csv,.txt,application/pdf,.pdf"
          />
          
          <button 
            onClick={() => bankInputRef.current?.click()}
            disabled={bankMutation.isPending}
            className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 transition-all text-sm font-semibold flex items-center space-x-2"
          >
            <CreditCard className="w-4 h-4" />
            <span>{bankMutation.isPending ? t('common.loading') : t('bank.uploadStatement')}</span>
          </button>

          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            className="premium-button premium-gradient text-white flex items-center space-x-2"
          >
            {uploadMutation.isPending ? (
              <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            ) : (
              <Upload className="w-5 h-5" />
            )}
            <span>{uploadMutation.isPending ? t('common.loading') : t('dashboard.uploadVoucher')}</span>
          </button>
        </div>}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Yhtiöt & Osakkaat" 
          value={`${companyStats?.totalCompanies || 0} / ${companyStats?.totalShareholders || 0}`}
          icon={Users}
          to="/companies"
          hint="Avaa"
        />
        <StatCard
          title="Automaatioaste"
          value={`${accStats?.automationRate?.toFixed(1) || 0}%`}
          icon={Activity}
        />
        <StatCard
          title="Käsittelemättömät"
          value={accStats?.pendingEntries?.toString() || "0"}
          icon={AlertCircle}
          to="/pending"
          hint="Käsittele"
        />
        <StatCard
          title="Vahvistetut"
          value={accStats?.postedEntries?.toString() || "0"}
          icon={FileCheck}
          to="/ledger"
          hint="Pääkirja"
        />
      </div>

      {selectedCompany && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <TimeCard companyId={selectedCompany.id} canWrite={canWrite} userId={user?.id} />
          <MissingVouchersCard companyId={selectedCompany.id} canWrite={canWrite} userEmail={user?.email} />
          <CompanyInfoCard company={selectedCompany} canManage={canManage} />
        </div>
      )}

      {/* Main Content Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Vouchers */}
        <div className="lg:col-span-2 glass-card overflow-hidden">
          <div className="p-6 border-b border-white/5 flex items-center justify-between">
            <h3 className="font-semibold text-lg">Viimeisimmät tositteet</h3>
            <Link to="/ledger" className="text-sm text-primary-400 hover:text-primary-300 font-medium transition-colors">Katso kaikki</Link>
          </div>
          <div className="p-0">
            <table className="w-full text-left">
              <thead>
                <tr className="text-slate-400 text-sm border-b border-white/5">
                  <th className="px-6 py-4 font-medium uppercase">Päivämäärä</th>
                  <th className="px-6 py-4 font-medium uppercase">Yhtiö</th>
                  <th className="px-6 py-4 font-medium uppercase">Tyyppi</th>
                  <th className="px-6 py-4 font-medium uppercase text-right">Summa</th>
                  <th className="px-6 py-4 font-medium uppercase text-center">Tila</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {ledgerLoading ? (
                  [1, 2, 3].map(i => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={5} className="px-6 py-4 h-16 bg-white/5"></td>
                    </tr>
                  ))
                ) : ledger?.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-slate-500 italic">
                      Ei kirjanpitotapahtumia valitulle yhtiölle.
                    </td>
                  </tr>
                ) : (
                  ledger?.map((entry: any) => (
                    <tr key={entry.id} className="hover:bg-white/5 transition-colors group cursor-pointer">
                      <td className="px-6 py-4 text-sm">{new Date(entry.entryDate).toLocaleDateString('fi-FI')}</td>
                      <td className="px-6 py-4 text-sm font-medium">
                        <div className="flex flex-col">
                          <span>{entry.lines[0]?.description || 'Liiketapahtuma'}</span>
                          {entry.suggestion?.suggested_account && entry.status !== 'POSTED' && (
                            <div className="mt-1">
                              <SuggestionBadge 
                                accountCode={entry.suggestion.suggested_account} 
                                label={entry.suggestion.top_predictions[0]?.label || ''} 
                                confidence={entry.suggestion.confidence} 
                              />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-400">{entry.voucherNumber}</td>
                      <td className="px-6 py-4 text-sm text-right font-semibold">
                        {(entry.lines?.reduce((sum: number, l: any) => sum + parseFloat(l.debit || 0), 0)).toLocaleString('fi-FI', { minimumFractionDigits: 2 })} €
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase border ${
                          entry.status === 'POSTED' 
                            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' 
                            : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                        }`}>
                          {entry.status === 'POSTED' ? 'Vahvistettu' : 'Odottaa'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-card">
          <div className="p-6 border-b border-white/5">
            <h3 className="font-semibold text-lg">Järjestelmän tila</h3>
          </div>
          <div className="p-6 space-y-6">
            {/* Palveluiden /health on juuressa, ei /api/v1-polun alla */}
            {SINGLE_SERVER !== undefined ? (
              <ServiceStatus name="Palvelin" url={SINGLE_SERVER} />
            ) : (
              <>
                <ServiceStatus name="User Service" url="http://localhost:3001" />
                <ServiceStatus name="Accounting Service" url="http://localhost:3002" />
                <ServiceStatus name="Voucher Service" url="http://localhost:3003" />
                <ServiceStatus name="Bank Service" url="http://localhost:3005" />
                <ServiceStatus name="ML Service" url="http://localhost:8001" />
              </>
            )}

            <div className="pt-4">
              <h4 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Kafka Tapahtumakuorma</h4>
              <div className="h-24 flex items-end space-x-1">
                {[40, 60, 45, 78, 90, 65, 55, 40, 60, 80, 70, 45, 50, 65, 75, 90, 100, 85, 70, 50].map((h, i) => (
                  <motion.div 
                    key={i} 
                    initial={{ height: 0 }}
                    animate={{ height: `${h}%` }}
                    transition={{ delay: i * 0.05 }}
                    className="flex-1 bg-primary-500/20 hover:bg-primary-500/40 transition-colors rounded-t-sm" 
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
