import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getFeeSetup } from '../api/fees';
import { useCompany } from '../hooks/useCompany';
import ReskontraTab from '../components/fees/ReskontraTab';
import RunTab from '../components/fees/RunTab';
import RemindersTab from '../components/fees/RemindersTab';
import SetupTab from '../components/fees/SetupTab';
import ShareholdersTab from '../components/fees/ShareholdersTab';
import { ErrorBox } from '../components/fees/common';

const TABS = [
  { key: 'reskontra', label: 'Reskontra' },
  { key: 'run', label: 'Laskutusajo' },
  { key: 'reminders', label: 'Muistutukset' },
  { key: 'setup', label: 'Perusteet' },
  { key: 'shareholders', label: 'Osakasluettelo' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** Vastikereskontra: osakasluettelo, vastikeperusteet, laskutusajo, saldot ja maksumuistutukset. */
const FeesPage = () => {
  const { selectedCompany, canWrite, canManage } = useCompany();
  const companyId = selectedCompany?.id;
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>(() => {
    try { return (localStorage.getItem('feesTab') as Tab) || 'reskontra'; } catch { return 'reskontra'; }
  });
  const choose = (t: Tab) => {
    setTab(t);
    try { localStorage.setItem('feesTab', t); } catch { /* ei tallennusta */ }
  };

  const setup = useQuery({
    queryKey: ['fee-setup', companyId],
    queryFn: () => getFeeSetup(companyId!),
    enabled: !!companyId && (tab === 'setup' || tab === 'shareholders'),
  });
  const refreshSetup = () => queryClient.invalidateQueries({ queryKey: ['fee-setup', companyId] });

  if (!companyId) return <div className="glass-card p-8 text-center text-slate-400">Valitse ensin yhtiö.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Vastikkeet</h2>
        <p className="text-slate-400 mt-1">{selectedCompany?.name}: vastikkeiden laskutus, suoritukset ja maksumuistutukset huoneistoittain.</p>
      </div>
      <div className="flex flex-wrap gap-1 bg-slate-900/50 p-1 rounded-xl border border-white/5 w-fit">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => choose(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${tab === t.key ? 'bg-primary-500 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'reskontra' && <ReskontraTab companyId={companyId} canWrite={canWrite} />}
      {tab === 'run' && <RunTab companyId={companyId} canWrite={canWrite} />}
      {tab === 'reminders' && <RemindersTab companyId={companyId} canWrite={canWrite} />}
      {(tab === 'setup' || tab === 'shareholders') && (
        setup.isLoading ? <div className="glass-card h-64 animate-pulse" />
          : setup.error || !setup.data ? <ErrorBox text="Vastiketietoja ei saatu haettua laskutuspalvelusta." />
            : tab === 'setup'
              ? <SetupTab companyId={companyId} setup={setup.data} canManage={canManage} onSaved={refreshSetup} />
              : <ShareholdersTab companyId={companyId} setup={setup.data} canWrite={canWrite} onSaved={refreshSetup} />
      )}
    </div>
  );
};

export default FeesPage;
