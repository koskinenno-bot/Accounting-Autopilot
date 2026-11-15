import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Mail, CheckCircle, XCircle, Clock, Search, Inbox, AlertTriangle } from 'lucide-react';
import { getMailStatus, getNotificationHistory, sendTestEmail } from '../api/notifications';
import { useCompany } from '../hooks/useCompany';
import { useAuth } from '../hooks/useAuth';

const STATUS: Record<string, { label: string; icon: ReactElement }> = {
  SENT: { label: 'Lähetetty', icon: <CheckCircle className="w-4 h-4 text-emerald-500" /> },
  FAILED: { label: 'Epäonnistui', icon: <XCircle className="w-4 h-4 text-red-500" /> },
  OUTBOX: { label: 'Ei lähetetty (testitila)', icon: <Inbox className="w-4 h-4 text-amber-400" /> },
  PENDING: { label: 'Jonossa', icon: <Clock className="w-4 h-4 text-primary-500" /> },
};
const errText = (err: any) => err?.response?.data?.error || err?.message || 'Toiminto epäonnistui';

/** Viestintä: lähetyksen tila, testiviesti ja yhtiön viestihistoria. */
const NotificationHistoryPage = () => {
  const { t } = useTranslation();
  const { selectedCompany, canWrite } = useCompany();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [testTo, setTestTo] = useState<string>(user?.email ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: history, isLoading } = useQuery({
    queryKey: ['notification-history', selectedCompany?.id],
    queryFn: () => getNotificationHistory(selectedCompany!.id),
    enabled: !!selectedCompany?.id,
  });
  const status = useQuery({ queryKey: ['mail-status'], queryFn: getMailStatus, retry: false });
  const test = useMutation({
    mutationFn: () => sendTestEmail(selectedCompany!.id, testTo),
    onSuccess: (r) => {
      setError(null);
      setMessage(r.mode === 'smtp' ? `Testiviesti lähetetty osoitteeseen ${testTo}.` : 'Testiviesti tallennettiin outbox-kansioon, koska SMTP ei ole käytössä.');
      queryClient.invalidateQueries({ queryKey: ['notification-history'] });
    },
    onError: (err) => { setMessage(null); setError(errText(err)); queryClient.invalidateQueries({ queryKey: ['notification-history'] }); },
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (history ?? []).filter((n: any) => !q || `${n.recipient} ${n.subject ?? ''}`.toLowerCase().includes(q));
  }, [history, search]);

  const s = status.data;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('notifications.title')}</h2>
        <p className="text-slate-400 mt-1">Vastikelaskut, maksumuistutukset, kutsut ja salasanan vaihdot sähköpostilla.</p>
      </div>

      <div className="glass-card p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold">Sähköpostin lähetys</span>
          {status.isLoading ? <span className="text-slate-400">tarkistetaan…</span>
            : status.error ? <span className="text-red-300">Ilmoituspalvelu ei vastaa (portti 3008)</span>
            : s?.mode === 'outbox'
              ? <span className="text-amber-300 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />Testitila: viestejä ei lähetetä, ne tallennetaan kansioon apps\notification-service\outbox</span>
              : s?.ok
                ? <span className="text-emerald-300 flex items-center gap-1"><CheckCircle className="w-4 h-4" />Käytössä, lähettäjä {s.from}</span>
                : <span className="text-red-300 flex items-center gap-1"><XCircle className="w-4 h-4" />SMTP-yhteys ei toimi: {s?.error}</span>}
        </div>
        {s?.mode === 'outbox' && (
          <p className="text-xs text-slate-400">Ota lähetys käyttöön lisäämällä SMTP-asetukset tiedostoon apps\notification-service\.env (ks. PARANNUKSET.md, Sähköposti).</p>
        )}
        {canWrite && (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); test.mutate(); }}>
            <input type="email" required aria-label="Testiviestin vastaanottaja" value={testTo} onChange={(e) => setTestTo(e.target.value)}
              placeholder="oma@osoite.fi" className="bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:border-primary-500" />
            <button type="submit" disabled={test.isPending || !selectedCompany} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm hover:text-white disabled:opacity-50">
              {test.isPending ? 'Lähetetään…' : 'Lähetä testiviesti'}
            </button>
            {message && <span className="text-sm text-emerald-300">{message}</span>}
            {error && <span className="text-sm text-red-300">{error}</span>}
          </form>
        )}
      </div>

      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b border-white/5">
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Hae vastaanottajaa tai otsikkoa"
              className="w-full bg-slate-900/50 border border-white/10 rounded-lg py-2 pl-9 pr-4 text-sm focus:outline-none focus:border-primary-500" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-slate-400 text-xs uppercase tracking-wider border-b border-white/5">
                <th className="px-6 py-4 font-semibold">{t('notifications.recipient')}</th>
                <th className="px-6 py-4 font-semibold">{t('notifications.subject')}</th>
                <th className="px-6 py-4 font-semibold">{t('notifications.sentAt')}</th>
                <th className="px-6 py-4 font-semibold">{t('notifications.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                [1, 2, 3].map((i) => <tr key={i} className="animate-pulse"><td colSpan={4} className="px-6 py-4 h-16 bg-white/5" /></tr>)
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="px-6 py-12 text-center text-slate-500 italic">Ei viestejä.</td></tr>
              ) : rows.map((n: any) => {
                const st = STATUS[n.status] ?? STATUS.PENDING;
                return (
                  <tr key={n.id} className="align-top">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="p-2 bg-white/5 rounded-lg"><Mail className="w-4 h-4 text-slate-400" /></div>
                        <p className="text-sm font-medium">{n.recipient}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">{n.subject}</td>
                    <td className="px-6 py-4 text-sm text-slate-400">{new Date(n.sentAt || n.createdAt).toLocaleString('fi-FI')}</td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-2">{st.icon}<span>{st.label}</span></div>
                      {n.errorMessage && <div className="text-xs text-slate-500 mt-1 max-w-xs">{n.errorMessage}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default NotificationHistoryPage;
