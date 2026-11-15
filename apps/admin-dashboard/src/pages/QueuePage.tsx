import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlarmClock, CheckCheck, CheckCircle2, StickyNote } from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import { useAuth } from '../hooks/useAuth';
import { getQueue, postAutoApprovable, updateQueueTask } from '../api/accounting';
import type { QueueItem, QueueKind } from '../api/accounting';
import { getOrganizationMembers } from '../api/organizations';

const KIND_LABELS: Record<QueueKind, string> = {
  CLOSING: 'Tilinpäätös',
  INVOICE: 'Ostolasku',
  REVIEW: 'Tarkistettava kirjaus',
  VOUCHER: 'Puuttuva tosite',
  BANK: 'Tiliote',
  AUTO: 'Varmat kirjaukset',
};

const PRIORITY: Record<number, { label: string; className: string }> = {
  1: { label: 'Kiireellinen', className: 'text-red-300 bg-red-500/10 border-red-500/30' },
  2: { label: 'Tällä viikolla', className: 'text-amber-300 bg-amber-400/10 border-amber-400/30' },
  3: { label: 'Kun ehdit', className: 'text-slate-300 bg-white/5 border-white/10' },
};

const eur = (n: number) => n.toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const fiDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString('fi-FI') : '');
const plusDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const errorText = (err: any) => err?.response?.data?.error || 'Toiminto epäonnistui';

type Filter = 'all' | 'mine' | 'unassigned';

/** Poikkeusjono: kaikkien yhtiöiden tehtävät yhdessä listassa. */
const QueuePage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { companies, selectCompany, organization } = useCompany();
  const [filter, setFilter] = useState<Filter>('all');
  const [kind, setKind] = useState<QueueKind | ''>('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [noteFor, setNoteFor] = useState<QueueItem | null>(null);
  const [noteText, setNoteText] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  // Jono vain yhtiöistä, joissa käyttäjä voi kirjata (hallitus ja tarkastajat eivät käsittele jonoa)
  const writable = useMemo(
    () => (companies ?? []).filter((c) => c.myRole === 'MANAGER' || c.myRole === 'ASSISTANT'),
    [companies],
  );
  const ids = useMemo(() => writable.map((c) => c.id), [writable]);
  const nameOf = (id: string) => writable.find((c) => c.id === id)?.name ?? '';

  const { data: items, isLoading, error } = useQuery({
    queryKey: ['queue', ids, showSnoozed],
    queryFn: () => getQueue(ids, showSnoozed),
    enabled: ids.length > 0,
    refetchInterval: 60_000,
  });
  const { data: members } = useQuery({
    queryKey: ['org-members', organization?.id],
    queryFn: () => getOrganizationMembers(organization!.id),
    enabled: !!organization?.id,
  });
  const memberName = (id: string | null) => (id ? members?.find((m) => m.id === id)?.name ?? 'Muu käyttäjä' : null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['queue'] });
    queryClient.invalidateQueries({ queryKey: ['overview'] });
  };
  const update = useMutation({
    mutationFn: updateQueueTask,
    onSuccess: refresh,
    onError: (err) => setMessage(errorText(err)),
  });
  const approveSure = useMutation({
    mutationFn: (companyId: string) => postAutoApprovable(companyId),
    onSuccess: (r) => {
      setMessage(`${r.posted} kirjausta hyväksytty${r.skipped.length ? `, ${r.skipped.length} jäi hyväksymättä: ${[...new Set(r.skipped.map((x) => x.reason))].join('; ')}` : ''}.`);
      refresh();
      queryClient.invalidateQueries({ queryKey: ['pending'] });
    },
    onError: (err) => setMessage(errorText(err)),
  });

  const visible = (items ?? [])
    .filter((i) => filter === 'all' || (filter === 'mine' ? i.assignedTo === user?.id : !i.assignedTo))
    .filter((i) => !kind || i.kind === kind)
    .filter((i) => !companyFilter || i.companyId === companyFilter);

  const counts = {
    all: items?.length ?? 0,
    mine: items?.filter((i) => i.assignedTo === user?.id).length ?? 0,
    unassigned: items?.filter((i) => !i.assignedTo).length ?? 0,
  };

  const open = (item: QueueItem) => {
    selectCompany(item.companyId);
    switch (item.kind) {
      case 'REVIEW': return navigate(`/pending?entry=${item.entryId}`);
      case 'CLOSING': return navigate('/closing');
      case 'AUTO': return navigate('/pending');
      default: return navigate('/company'); // tositteen ja tiliotteen lataus, ostolaskut
    }
  };
  const actionLabel: Record<QueueKind, string> = {
    REVIEW: 'Käsittele', CLOSING: 'Avaa tilinpäätös', AUTO: 'Katso', VOUCHER: 'Lataa tosite', BANK: 'Tuo tiliote', INVOICE: 'Avaa yhtiö',
  };

  if (!companies) return <div className="glass-card h-64 animate-pulse" />;
  if (writable.length === 0) {
    return <div className="glass-card p-8 text-center text-slate-400">Sinulla ei ole kirjanpito-oikeutta yhteenkään yhtiöön, joten työjonossa ei ole tehtäviä.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Työjono</h2>
        <p className="text-slate-400 mt-1">Kaikki tehtävät {writable.length} yhtiöstä. Automaatio hoitaa muut; tässä on vain se, mikä tarvitsee ihmistä.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex bg-slate-900/50 p-1 rounded-xl border border-white/10">
          {([['all', 'Kaikki'], ['mine', 'Minulle'], ['unassigned', 'Jakamatta']] as [Filter, string][]).map(([f, label]) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm ${filter === f ? 'bg-primary-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
              {label} ({counts[f]})
            </button>
          ))}
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value as QueueKind | '')}
          className="bg-slate-900/50 border border-white/10 rounded-xl py-2 px-3 text-sm">
          <option value="">Kaikki tyypit</option>
          {(Object.keys(KIND_LABELS) as QueueKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
        </select>
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}
          className="bg-slate-900/50 border border-white/10 rounded-xl py-2 px-3 text-sm max-w-xs">
          <option value="">Kaikki yhtiöt</option>
          {writable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="flex items-center space-x-2 text-sm text-slate-300">
          <input type="checkbox" checked={showSnoozed} onChange={(e) => setShowSnoozed(e.target.checked)} />
          <span>Näytä myös myöhemmäksi siirretyt</span>
        </label>
      </div>

      {message && (
        <div className="p-3 rounded-lg bg-primary-500/10 border border-primary-500/20 text-sm flex justify-between">
          <span>{message}</span>
          <button type="button" onClick={() => setMessage(null)} className="text-slate-400">Sulje</button>
        </div>
      )}
      {error && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">Työjonoa ei saatu haettua: {errorText(error)}</div>}

      {isLoading ? (
        <div className="glass-card h-40 animate-pulse" />
      ) : visible.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
          <div className="text-lg font-semibold">Ei tehtäviä</div>
          <div className="text-slate-400 mt-1">{filter === 'mine' ? 'Sinulle ei ole annettu tehtäviä.' : 'Kaikki yhtiöt ovat ajan tasalla.'}</div>
        </div>
      ) : (
        <div className="glass-card divide-y divide-white/5">
          {visible.map((item) => {
            const p = PRIORITY[item.priority];
            const snoozed = item.snoozedUntil && new Date(item.snoozedUntil) > new Date();
            return (
              <div key={`${item.companyId}:${item.key}`} className={`p-4 flex flex-col lg:flex-row lg:items-center gap-3 ${snoozed ? 'opacity-60' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`px-2 py-0.5 rounded-md border ${p.className}`}>{p.label}</span>
                    <span className="text-slate-400">{KIND_LABELS[item.kind]}</span>
                    <span className="text-slate-500">·</span>
                    <span className="text-slate-300 font-medium">{nameOf(item.companyId)}</span>
                  </div>
                  <div className="font-semibold mt-1 truncate">
                    {item.title}
                    {item.amount !== undefined && <span className="text-slate-300 font-normal"> · {eur(item.amount)}</span>}
                  </div>
                  <div className="text-sm text-slate-400">
                    {item.detail}
                    {item.dueDate && item.kind !== 'CLOSING' ? ` · eräpäivä ${fiDate(item.dueDate)}` : ''}
                    {item.kind === 'CLOSING' && item.dueDate ? ` · määräpäivä ${fiDate(item.dueDate)}` : ''}
                  </div>
                  {(item.note || snoozed) && (
                    <div className="text-xs text-slate-400 mt-1 flex flex-wrap gap-3">
                      {item.note && <span className="inline-flex items-center"><StickyNote className="w-3 h-3 mr-1" />{item.note}</span>}
                      {snoozed && <span className="inline-flex items-center"><AlarmClock className="w-3 h-3 mr-1" />Muistutus {fiDate(item.snoozedUntil)}</span>}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <select
                    title="Kenelle tehtävä kuuluu"
                    value={item.assignedTo ?? ''}
                    onChange={(e) => update.mutate({ companyId: item.companyId, itemKey: item.key, assignedTo: e.target.value || null })}
                    className="bg-slate-900/50 border border-white/10 rounded-lg py-1.5 px-2 text-xs max-w-[11rem]"
                  >
                    <option value="">Ei vastuuhenkilöä</option>
                    {item.assignedTo && !members?.some((m) => m.id === item.assignedTo) && (
                      <option value={item.assignedTo}>{memberName(item.assignedTo)}</option>
                    )}
                    {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.id === user?.id ? `${m.name} (minä)` : m.name}</option>)}
                  </select>
                  <select
                    title="Siirrä myöhemmäksi"
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      update.mutate({ companyId: item.companyId, itemKey: item.key, snoozedUntil: v === 'clear' ? null : plusDays(Number(v)) });
                    }}
                    className="bg-slate-900/50 border border-white/10 rounded-lg py-1.5 px-2 text-xs"
                  >
                    <option value="">Myöhemmin…</option>
                    <option value="1">Huomenna</option>
                    <option value="7">Viikon päästä</option>
                    <option value="30">Kuukauden päästä</option>
                    {snoozed && <option value="clear">Palauta jonoon nyt</option>}
                  </select>
                  <button type="button" title="Muistiinpano" onClick={() => { setNoteFor(item); setNoteText(item.note ?? ''); }}
                    className="p-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-white">
                    <StickyNote className="w-4 h-4" />
                  </button>
                  {item.kind === 'AUTO' && (
                    <button type="button" disabled={approveSure.isPending} onClick={() => approveSure.mutate(item.companyId)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-sm inline-flex items-center">
                      <CheckCheck className="w-4 h-4 mr-1" />Hyväksy kaikki
                    </button>
                  )}
                  <button type="button" onClick={() => open(item)} className="px-3 py-1.5 rounded-lg premium-gradient text-white text-sm font-semibold">
                    {actionLabel[item.kind]}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {noteFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-slate-950/70" onClick={() => setNoteFor(null)} />
          <form className="w-full max-w-md glass-card p-6 relative z-10 border border-white/10 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate({ companyId: noteFor.companyId, itemKey: noteFor.key, note: noteText.trim() || null });
              setNoteFor(null);
            }}>
            <h3 className="text-lg font-bold">Muistiinpano</h3>
            <div className="text-sm text-slate-400">{nameOf(noteFor.companyId)}: {noteFor.title}</div>
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={4} maxLength={1000}
              placeholder="Esim. pyydetty kuitti hallituksen puheenjohtajalta 15.11."
              className="w-full bg-slate-900/50 border border-white/10 rounded-xl p-3 text-sm" />
            <div className="flex gap-3">
              <button type="button" onClick={() => setNoteFor(null)} className="flex-1 py-2 rounded-xl border border-white/10 text-slate-300">Peruuta</button>
              <button type="submit" className="flex-1 premium-button premium-gradient text-white">Tallenna</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default QueuePage;
