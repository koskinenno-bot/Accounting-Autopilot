import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Trash2 } from 'lucide-react';
import { createTimeEntry, deleteTimeEntry, getTimeEntries, getTimeSummary } from '../api/accounting';

const hours = (min: number) => (min / 60).toLocaleString('fi-FI', { maximumFractionDigits: 1 });
const todayStr = () => new Date().toLocaleDateString('sv-SE'); // VVVV-KK-PP paikallisessa ajassa

/** Yhtiön työaika: automaattisesti mitattu + käsin kirjattu, tavoite alle 10 h / vuosi. */
const TimeCard = ({ companyId, canWrite, userId }: { companyId: string; canWrite: boolean; userId?: string }) => {
  const qc = useQueryClient();
  const summary = useQuery({ queryKey: ['timeSummary', [companyId]], queryFn: () => getTimeSummary([companyId]) });
  const entries = useQuery({ queryKey: ['timeEntries', companyId], queryFn: () => getTimeEntries(companyId) });
  const [day, setDay] = useState(todayStr());
  const [mins, setMins] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['timeSummary'] });
    qc.invalidateQueries({ queryKey: ['timeEntries', companyId] });
  };
  const add = useMutation({
    mutationFn: () => createTimeEntry({ companyId, day, minutes: Math.round(Number(mins.replace(',', '.'))), note }),
    onSuccess: () => { setMins(''); setNote(''); setError(null); refresh(); },
    onError: (err: any) => setError(err?.response?.data?.error || 'Tallennus epäonnistui'),
  });
  const remove = useMutation({ mutationFn: deleteTimeEntry, onSuccess: refresh });

  const s = summary.data?.[0];
  const pct = s ? Math.min(100, (s.minutesYear / 60 / s.targetHours) * 100) : 0;
  const bar = s?.status === 'over' ? 'bg-red-500' : s?.status === 'warning' ? 'bg-amber-400' : 'bg-emerald-500';

  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate(); };

  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center space-x-2"><Clock className="w-5 h-5 text-primary-400" /><span>Työaika</span></h3>
        {s && <span className="text-sm text-slate-400">Tämä kuukausi {hours(s.minutesMonth)} h</span>}
      </div>
      {s && (
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span>Viimeiset 12 kk: <b>{hours(s.minutesYear)} h</b> / tavoite {s.targetHours} h</span>
            {s.projectedYearHours != null && <span className="text-slate-400">Ennuste vuodelle {s.projectedYearHours.toLocaleString('fi-FI')} h</span>}
          </div>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden"><div className={`h-full ${bar}`} style={{ width: `${pct}%` }} /></div>
          <p className="text-xs text-slate-500">Aika mitataan automaattisesti, kun isännöitsijä tai assistentti työskentelee yhtiön sivuilla. Kirjaa alle työ, joka tehtiin ohjelman ulkopuolella.</p>
        </div>
      )}
      {canWrite && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2 text-sm">
          <label className="space-y-1"><span className="block text-slate-400">Päivä</span>
            <input type="date" value={day} max={todayStr()} onChange={(e) => setDay(e.target.value)} className="bg-slate-900/50 border border-white/10 rounded-lg px-2 py-1.5" required />
          </label>
          <label className="space-y-1"><span className="block text-slate-400">Minuutit</span>
            <input inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} className="w-24 bg-slate-900/50 border border-white/10 rounded-lg px-2 py-1.5" required />
          </label>
          <label className="space-y-1 flex-1 min-w-[10rem]"><span className="block text-slate-400">Mitä tehtiin</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="esim. puhelu hallituksen pj:n kanssa" className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-2 py-1.5" />
          </label>
          <button type="submit" disabled={add.isPending} className="px-3 py-1.5 rounded-lg bg-primary-500 hover:bg-primary-400 disabled:opacity-50 font-semibold">Kirjaa</button>
        </form>
      )}
      {error && <div className="text-sm text-red-400">{error}</div>}
      {(entries.data?.entries.length ?? 0) > 0 && (
        <ul className="text-sm divide-y divide-white/5">
          {entries.data!.entries.slice(0, 10).map((e) => (
            <li key={e.id} className="py-1.5 flex items-center justify-between gap-3">
              <span className="text-slate-300">{new Date(e.day).toLocaleDateString('fi-FI', { timeZone: 'UTC' })} · {e.minutes} min{e.note ? ` · ${e.note}` : ''}</span>
              {canWrite && e.userId === userId && (
                <button type="button" title="Poista" onClick={() => remove.mutate(e.id)} className="text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default TimeCard;
