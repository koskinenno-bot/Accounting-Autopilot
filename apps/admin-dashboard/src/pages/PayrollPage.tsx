import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, Plus, Trash2 } from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import {
  deleteContract, deleteRun, getContractReport, getContracts, getPayees, getPayrollReports, getPayrollSettings, getRun, getRuns,
  markReport, markRunReported, postRun, saveContract, savePayee, savePayrollSettings, saveRun,
} from '../api/payroll';
import type { Contract, IncomeType, Payee, Rates, RunInput } from '../api/payroll';
import { ErrorBox, InfoBox, eur, fmtDate, inputClass, smallButton } from '../components/fees/common';

type Tab = 'runs' | 'payees' | 'reports' | 'contracts' | 'settings';
const TABS: { key: Tab; label: string }[] = [
  { key: 'runs', label: 'Palkanmaksut' },
  { key: 'payees', label: 'Palkansaajat' },
  { key: 'reports', label: 'Tulorekisteri' },
  { key: 'contracts', label: 'Urakkatiedot' },
  { key: 'settings', label: 'Asetukset' },
];
const TYPE_LABEL: Record<IncomeType, string> = {
  '201': '201 Aikapalkka', '210': '210 Kokouspalkkio', '215': '215 Luottamustoimipalkkio', '308': '308 Hallintoelimen jäsenpalkkio',
};
const errText = (err: any) => err?.response?.data?.error || err?.message || 'Toiminto epäonnistui';
const today = () => new Date().toISOString().slice(0, 10);
const toNum = (s: string) => Number(String(s).replace(',', '.').replace(/\s/g, ''));
const fi = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
const primary = 'premium-button premium-gradient text-white disabled:opacity-50';
const overdue = (due: string, done: string | null) => !done && new Date(due) < new Date(today());

const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`glass-card p-5 ${className}`}>{children}</div>
);
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1 text-sm"><span className="text-slate-400">{label}</span>{children}</label>
);

// ---------------------------------------------------------------- palkanmaksut

type Row = { payeeId: string; incomeType: IncomeType; amount: string; description: string };

const RunEditor = ({ companyId, payees, runId, initial, onDone }: {
  companyId: string; payees: Payee[]; runId: string | null; initial?: RunInput; onDone: (id?: string) => void;
}) => {
  const [payDate, setPayDate] = useState(initial?.payDate ?? today());
  const [periodStart, setPeriodStart] = useState(initial?.periodStart ?? today());
  const [periodEnd, setPeriodEnd] = useState(initial?.periodEnd ?? today());
  const [description, setDescription] = useState(initial?.description ?? '');
  const [rows, setRows] = useState<Row[]>(initial?.items.map((i) => ({ ...i, amount: fi(i.amount), description: i.description ?? '' })) ?? []);
  const [error, setError] = useState<string | null>(null);
  const active = payees.filter((p) => p.isActive);
  const addAll = () => setRows(active.map((p) => ({ payeeId: p.id, incomeType: p.defaultIncomeType, amount: fi(p.defaultAmount), description: '' })));
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = useMutation({
    mutationFn: () => saveRun(runId, {
      companyId, payDate, periodStart, periodEnd, description,
      items: rows.filter((r) => r.payeeId && r.amount).map((r) => ({ ...r, amount: toNum(r.amount) })),
    }),
    onSuccess: (r) => onDone(r?.run?.id ?? runId ?? undefined),
    onError: (err) => setError(errText(err)),
  });
  return (
    <Card className="space-y-4">
      <div className="font-semibold">{runId ? 'Muokkaa palkanmaksua' : 'Uusi palkanmaksu'}</div>
      <div className="grid md:grid-cols-4 gap-3">
        <Field label="Maksupäivä"><input type="date" className={inputClass} value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
        <Field label="Ansaintajakso alkaa"><input type="date" className={inputClass} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></Field>
        <Field label="Ansaintajakso päättyy"><input type="date" className={inputClass} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></Field>
        <Field label="Selite"><input className={inputClass} value={description} placeholder="esim. Hallituksen kokouspalkkiot 11/2026" onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
        <thead><tr className="text-slate-400 text-left"><th className="pb-2 font-medium">Saaja</th><th className="pb-2 font-medium">Tulolaji</th><th className="pb-2 font-medium w-32">Summa €</th><th className="pb-2 font-medium">Lisätieto</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/5">
              <td className="py-1 pr-2">
                <select aria-label="Saaja" className={`${inputClass} w-full`} value={r.payeeId} onChange={(e) => set(i, { payeeId: e.target.value })}>
                  <option value="">Valitse</option>
                  {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </td>
              <td className="py-1 pr-2">
                <select aria-label="Tulolaji" className={`${inputClass} w-full`} value={r.incomeType} onChange={(e) => set(i, { incomeType: e.target.value as IncomeType })}>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
              <td className="py-1 pr-2"><input aria-label="Summa" className={`${inputClass} w-full text-right`} value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} /></td>
              <td className="py-1 pr-2"><input className={`${inputClass} w-full`} value={r.description} placeholder="esim. 4 kokousta" onChange={(e) => set(i, { description: e.target.value })} /></td>
              <td><button type="button" className="text-slate-500 hover:text-red-300" aria-label="Poista rivi" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={smallButton} onClick={() => setRows([...rows, { payeeId: '', incomeType: '210', amount: '', description: '' }])}><Plus className="w-4 h-4 inline" /> Rivi</button>
        {active.length > 0 && <button type="button" className={smallButton} onClick={addAll}>Kaikki aktiiviset oletussummilla</button>}
        <div className="flex-1" />
        <button type="button" className={smallButton} onClick={() => onDone()}>Peruuta</button>
        <button type="button" className={primary} disabled={save.isPending || !rows.length} onClick={() => { setError(null); save.mutate(); }}>Tallenna luonnos</button>
      </div>
      <ErrorBox text={error} />
    </Card>
  );
};

const RunDetailView = ({ id, canWrite, canManage, payees, companyId, onClose }: {
  id: string; canWrite: boolean; canManage: boolean; payees: Payee[]; companyId: string; onClose: () => void;
}) => {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payrollRun', id], queryFn: () => getRun(id) });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['payrollRun', id] }); qc.invalidateQueries({ queryKey: ['payrollRuns'] }); qc.invalidateQueries({ queryKey: ['payrollReports'] }); };
  const post = useMutation({ mutationFn: () => postRun(id), onSuccess: () => { setError(null); refresh(); }, onError: (e) => setError(errText(e)) });
  const remove = useMutation({ mutationFn: () => deleteRun(id), onSuccess: () => { refresh(); onClose(); }, onError: (e) => setError(errText(e)) });
  if (q.isLoading) return <div className="glass-card h-40 animate-pulse" />;
  if (q.error || !q.data) return <ErrorBox text={errText(q.error)} />;
  const { run, slips, totals, warnings, lines, items } = q.data;
  if (editing) {
    return (
      <RunEditor companyId={companyId} payees={payees} runId={id}
        initial={{ companyId, payDate: run.payDate, periodStart: run.periodStart, periodEnd: run.periodEnd, description: run.description, items: items.map((i) => ({ ...i, description: i.description ?? undefined })) }}
        onDone={() => { setEditing(false); refresh(); }} />
    );
  }
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-semibold">#{run.number} {run.description}</div>
        <span className="text-sm text-slate-400">Maksupäivä {fmtDate(run.payDate)}</span>
        {run.status === 'POSTED'
          ? <span className="text-emerald-300 text-sm flex items-center gap-1"><CheckCircle className="w-4 h-4" />Kirjattu (PALKKA-{run.number})</span>
          : <span className="text-amber-300 text-sm">Luonnos</span>}
        <div className="flex-1" />
        {run.status === 'DRAFT' && canWrite && <button type="button" className={smallButton} onClick={() => setEditing(true)}>Muokkaa</button>}
        {run.status === 'DRAFT' && canWrite && <button type="button" className={smallButton} onClick={() => remove.mutate()}>Poista luonnos</button>}
        {run.status === 'DRAFT' && canManage && <button type="button" className={primary} disabled={post.isPending} onClick={() => post.mutate()}>Hyväksy ja kirjaa</button>}
        <button type="button" className={smallButton} onClick={onClose}>Sulje</button>
      </div>
      {warnings.length > 0 && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-200 space-y-1">
          {warnings.map((w) => <div key={w} className="flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{w}</div>)}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
          <thead>
            <tr className="text-slate-400 text-right">
              <th className="pb-2 font-medium text-left">Saaja</th><th className="pb-2 font-medium">Brutto</th><th className="pb-2 font-medium">Ennakonpid.</th>
              <th className="pb-2 font-medium">TyEL (tt)</th><th className="pb-2 font-medium">Tyött. (tt)</th><th className="pb-2 font-medium">Netto</th>
              <th className="pb-2 font-medium">Sivukulut</th>
            </tr>
          </thead>
          <tbody className="font-mono text-right">
            {slips.map((s) => (
              <tr key={s.payeeId} className="border-t border-white/5">
                <td className="py-2 text-left font-sans">
                  <div>{s.name}</div>
                  <div className="text-xs text-slate-500">{Object.keys(s.byType).map((k) => TYPE_LABEL[k as IncomeType]).join(', ')}{s.age !== null ? ` · ${s.age} v` : ''}</div>
                </td>
                <td>{eur(s.gross / 100)}</td><td>{eur(s.withholding / 100)}</td><td>{eur(s.tyelEmployee / 100)}</td>
                <td>{eur(s.unemploymentEmployee / 100)}</td><td className="font-semibold">{eur(s.net / 100)}</td>
                <td>{eur((s.tyelEmployer + s.unemploymentEmployer + s.healthEmployer + s.accident) / 100)}</td>
              </tr>
            ))}
            <tr className="border-t border-white/20 font-semibold">
              <td className="py-2 text-left font-sans">Yhteensä</td>
              <td>{eur(totals.gross / 100)}</td><td>{eur(totals.withholding / 100)}</td><td>{eur(totals.tyelEmployee / 100)}</td>
              <td>{eur(totals.unemploymentEmployee / 100)}</td><td>{eur(totals.net / 100)}</td><td>{eur(totals.employerCost / 100)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="grid md:grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-slate-400 mb-1">Kirjanpitovienti maksupäivälle</div>
          {lines.map((l) => (
            <div key={l.accountNumber} className="flex justify-between border-t border-white/5 py-1">
              <span>{l.accountNumber} {l.description}</span>
              <span className="font-mono whitespace-nowrap pl-3">{l.debit ? `D ${eur(l.debit)}` : `K ${eur(l.credit)}`}</span>
            </div>
          ))}
        </div>
        <div className="space-y-1 text-slate-300">
          <div className="text-slate-400 mb-1">Maksettavaa</div>
          <div>Saajille nettona <span className="font-mono">{eur(totals.net / 100)}</span> maksupäivänä (tililtä 2840).</div>
          <div>Verohallinnolle <span className="font-mono">{eur((totals.withholding + totals.healthEmployer) / 100)}</span> (ennakonpidätys ja sv-maksu) seuraavan kuun 12. päivään mennessä.</div>
          {totals.tyelEmployee + totals.tyelEmployer + totals.unemploymentEmployee + totals.unemploymentEmployer > 0 && (
            <div>Työeläkeyhtiölle ja Työllisyysrahastolle <span className="font-mono">{eur((totals.tyelEmployee + totals.tyelEmployer + totals.unemploymentEmployee + totals.unemploymentEmployer + totals.accident) / 100)}</span> laskun mukaan.</div>
          )}
          <div>Palkkatietoilmoitus tulorekisteriin viimeistään <span className="font-semibold">{fmtDate(run.wageReportDue)}</span>.</div>
        </div>
      </div>
      <ErrorBox text={error} />
    </Card>
  );
};

const RunsTab = ({ companyId, canWrite, canManage, payees }: { companyId: string; canWrite: boolean; canManage: boolean; payees: Payee[] }) => {
  const [year, setYear] = useState(new Date().getFullYear());
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payrollRuns', companyId, year], queryFn: () => getRuns(companyId, year) });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Vuosi" className={inputClass} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[0, 1, 2].map((d) => new Date().getFullYear() - d).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className="flex-1" />
        {canWrite && !creating && (
          <button type="button" className={primary} disabled={!payees.length} onClick={() => { setCreating(true); setOpen(null); }}>
            <Plus className="w-4 h-4 inline" /> Uusi palkanmaksu
          </button>
        )}
      </div>
      {!payees.length && <InfoBox>Lisää ensin palkansaajat (hallituksen jäsenet, talonmies) Palkansaajat-välilehdellä.</InfoBox>}
      {creating && <RunEditor companyId={companyId} payees={payees} runId={null} onDone={(id) => { setCreating(false); qc.invalidateQueries({ queryKey: ['payrollRuns'] }); if (id) setOpen(id); }} />}
      {open && <RunDetailView key={open} id={open} companyId={companyId} canWrite={canWrite} canManage={canManage} payees={payees} onClose={() => setOpen(null)} />}
      <Card>
        {q.isLoading ? <div className="h-20 animate-pulse" /> : !q.data?.length ? <div className="text-sm text-slate-400">Ei palkanmaksuja vuonna {year}.</div> : (
          <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
            <thead><tr className="text-slate-400 text-left"><th className="pb-2 font-medium">#</th><th className="pb-2 font-medium">Maksupäivä</th><th className="pb-2 font-medium">Selite</th><th className="pb-2 font-medium text-right">Brutto</th><th className="pb-2 font-medium pl-6">Tila</th><th className="pb-2 font-medium">Tulorekisteri</th><th /></tr></thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="py-2">{r.number}</td><td>{fmtDate(r.payDate)}</td><td>{r.description}</td>
                  <td className="text-right font-mono">{r.totals ? eur(r.totals.gross / 100) : '–'}</td>
                  <td className="pl-6">{r.status === 'POSTED' ? <span className="text-emerald-300">Kirjattu</span> : <span className="text-amber-300">Luonnos</span>}</td>
                  <td>{r.status !== 'POSTED' ? '–' : r.wageReportedAt
                    ? <span className="text-emerald-300">Ilmoitettu</span>
                    : <span className={overdue(r.wageReportDue, null) ? 'text-red-300' : 'text-slate-300'}>Viim. {fmtDate(r.wageReportDue)}</span>}</td>
                  <td className="text-right"><button type="button" className={smallButton} onClick={() => { setOpen(r.id); setCreating(false); }}>Avaa</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------- palkansaajat

const emptyPayee = { name: '', role: '', hetu: '', iban: '', taxPercent: '', taxAdditionalPercent: '', taxIncomeLimit: '', taxCardYear: String(new Date().getFullYear()), defaultIncomeType: '210' as IncomeType, defaultAmount: '', isActive: true };

const PayeesTab = ({ companyId, payees, canWrite }: { companyId: string; payees: Payee[]; canWrite: boolean }) => {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ id: string | null; f: typeof emptyPayee; masked?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = (p: Payee | null) => {
    setError(null);
    setEdit(p ? {
      id: p.id, masked: p.hetu,
      f: { name: p.name, role: p.role ?? '', hetu: '', iban: p.iban ?? '', taxPercent: fi(p.taxPercent), taxAdditionalPercent: fi(p.taxAdditionalPercent), taxIncomeLimit: fi(p.taxIncomeLimit), taxCardYear: p.taxCardYear ? String(p.taxCardYear) : '', defaultIncomeType: p.defaultIncomeType, defaultAmount: fi(p.defaultAmount), isActive: p.isActive },
    } : { id: null, f: { ...emptyPayee } });
  };
  const save = useMutation({
    mutationFn: () => {
      const { hetu, ...f } = edit!.f;
      return savePayee(companyId, edit!.id, { ...f, ...(hetu || !edit!.id ? { hetu } : {}) });
    },
    onSuccess: () => { setEdit(null); qc.invalidateQueries({ queryKey: ['payees'] }); },
    onError: (e) => setError(errText(e)),
  });
  const f = edit?.f;
  const setF = (patch: Partial<typeof emptyPayee>) => setEdit({ ...edit!, f: { ...edit!.f, ...patch } });
  return (
    <div className="space-y-4">
      {canWrite && !edit && <button type="button" className={primary} onClick={() => open(null)}><Plus className="w-4 h-4 inline" /> Lisää palkansaaja</button>}
      {edit && f && (
        <Card className="space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Nimi"><input aria-label="Nimi" className={inputClass} value={f.name} onChange={(e) => setF({ name: e.target.value })} /></Field>
            <Field label="Tehtävä"><input className={inputClass} value={f.role} placeholder="esim. hallituksen puheenjohtaja" onChange={(e) => setF({ role: e.target.value })} /></Field>
            <Field label={edit.masked ? `Henkilötunnus (tallennettu ${edit.masked})` : 'Henkilötunnus'}>
              <input aria-label="Henkilötunnus" className={inputClass} value={f.hetu} placeholder={edit.masked ? 'jätä tyhjäksi, jos ei muutu' : 'PPKKVV-NNNT'} onChange={(e) => setF({ hetu: e.target.value })} />
            </Field>
            <Field label="Tilinumero (IBAN)"><input className={inputClass} value={f.iban} onChange={(e) => setF({ iban: e.target.value })} /></Field>
            <Field label="Oletustulolaji">
              <select className={inputClass} value={f.defaultIncomeType} onChange={(e) => setF({ defaultIncomeType: e.target.value as IncomeType })}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Oletussumma €"><input className={inputClass} value={f.defaultAmount} onChange={(e) => setF({ defaultAmount: e.target.value })} /></Field>
          </div>
          <div className="text-sm text-slate-400 pt-2">Verokortti (tyhjä pidätysprosentti = ei verokorttia, pidätys 60 %)</div>
          <div className="grid md:grid-cols-4 gap-3">
            <Field label="Pidätysprosentti"><input aria-label="Pidätysprosentti" className={inputClass} value={f.taxPercent} onChange={(e) => setF({ taxPercent: e.target.value })} /></Field>
            <Field label="Lisäprosentti"><input className={inputClass} value={f.taxAdditionalPercent} onChange={(e) => setF({ taxAdditionalPercent: e.target.value })} /></Field>
            <Field label="Tuloraja €"><input className={inputClass} value={f.taxIncomeLimit} onChange={(e) => setF({ taxIncomeLimit: e.target.value })} /></Field>
            <Field label="Verokortin vuosi"><input className={inputClass} value={f.taxCardYear} onChange={(e) => setF({ taxCardYear: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ isActive: e.target.checked })} />Aktiivinen</label>
          <div className="flex gap-2">
            <button type="button" className={primary} disabled={save.isPending} onClick={() => save.mutate()}>Tallenna</button>
            <button type="button" className={smallButton} onClick={() => setEdit(null)}>Peruuta</button>
          </div>
          <ErrorBox text={error} />
        </Card>
      )}
      <Card>
        {!payees.length ? <div className="text-sm text-slate-400">Ei palkansaajia.</div> : (
          <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
            <thead><tr className="text-slate-400 text-left"><th className="pb-2 font-medium">Nimi</th><th className="pb-2 font-medium">Tehtävä</th><th className="pb-2 font-medium">Henkilötunnus</th><th className="pb-2 font-medium">Verokortti</th><th className="pb-2 font-medium">Oletus</th><th /></tr></thead>
            <tbody>
              {payees.map((p) => (
                <tr key={p.id} className={`border-t border-white/5 ${p.isActive ? '' : 'text-slate-500'}`}>
                  <td className="py-2">{p.name}</td><td>{p.role ?? ''}</td>
                  <td>{p.hetu ?? <span className="text-amber-300">puuttuu</span>}</td>
                  <td>{p.taxPercent === null ? <span className="text-amber-300">ei verokorttia (60 %)</span> : `${fi(p.taxPercent)} %${p.taxAdditionalPercent !== null ? ` / ${fi(p.taxAdditionalPercent)} % (raja ${eur(p.taxIncomeLimit ?? 0)})` : ''}${p.taxCardYear ? `, ${p.taxCardYear}` : ''}`}</td>
                  <td>{TYPE_LABEL[p.defaultIncomeType]}{p.defaultAmount ? `, ${eur(p.defaultAmount)}` : ''}</td>
                  <td className="text-right">{canWrite && <button type="button" className={smallButton} onClick={() => open(p)}>Muokkaa</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------- tulorekisteri

const ReportsTab = ({ companyId, canWrite }: { companyId: string; canWrite: boolean }) => {
  const [year, setYear] = useState(new Date().getFullYear());
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payrollReports', companyId, year], queryFn: () => getPayrollReports(companyId, year) });
  const [error, setError] = useState<string | null>(null);
  const done = () => { setError(null); qc.invalidateQueries({ queryKey: ['payrollReports'] }); qc.invalidateQueries({ queryKey: ['payrollRuns'] }); };
  const markRun = useMutation({ mutationFn: (v: { id: string; reported: boolean }) => markRunReported(v.id, v.reported), onSuccess: done, onError: (e) => setError(errText(e)) });
  const markMonth = useMutation({ mutationFn: (v: { key: string; reported: boolean }) => markReport(companyId, 'EMPLOYER', v.key, v.reported), onSuccess: done, onError: (e) => setError(errText(e)) });
  const ins = q.data?.settings;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select aria-label="Vuosi" className={inputClass} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[0, 1, 2].map((d) => new Date().getFullYear() - d).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <InfoBox>
        Ilmoitukset annetaan tulorekisterin asiointipalvelussa (tulorekisteri.fi) Suomi.fi-valtuuksilla. Palkkatietoilmoitus
        annetaan 5 päivän kuluessa maksupäivästä, työnantajan erillisilmoitus maksukuukautta seuraavan kuun 5. päivään mennessä.
        Kokouspalkkiot ilmoitetaan tulolajilla 210 ilman sosiaalivakuutusmaksuja.
      </InfoBox>
      <ErrorBox text={error} />
      <Card className="space-y-3">
        <div className="font-semibold">Palkkatietoilmoitukset</div>
        {!q.data?.wageReports.length ? <div className="text-sm text-slate-400">Ei kirjattuja palkanmaksuja.</div> : q.data.wageReports.map((r) => (
          <div key={r.id} className="border-t border-white/5 pt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold">Maksupäivä {fmtDate(r.payDate)}</span>
              <span className="text-slate-400">Ansaintajakso {fmtDate(r.periodStart)}–{fmtDate(r.periodEnd)}</span>
              {r.wageReportedAt
                ? <span className="text-emerald-300 flex items-center gap-1"><CheckCircle className="w-4 h-4" />Ilmoitettu {fmtDate(r.wageReportedAt)}</span>
                : <span className={overdue(r.wageReportDue, null) ? 'text-red-300' : 'text-amber-300'}>Viimeistään {fmtDate(r.wageReportDue)}</span>}
              <div className="flex-1" />
              {canWrite && <button type="button" className={smallButton} onClick={() => markRun.mutate({ id: r.id, reported: !r.wageReportedAt })}>{r.wageReportedAt ? 'Peru merkintä' : 'Merkitse ilmoitetuksi'}</button>}
            </div>
            <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
              <thead><tr className="text-slate-400 text-left"><th className="font-medium">Tulonsaaja</th><th className="font-medium">Henkilötunnus</th><th className="font-medium">Tulolajit</th><th className="font-medium text-right">402 Ennakonpidätys</th><th className="font-medium text-right">413 TyEL</th><th className="font-medium text-right">414 Tyött.</th><th className="font-medium">Vakuuttaminen</th></tr></thead>
              <tbody>
                {r.slips.map((s) => (
                  <tr key={s.name} className="border-t border-white/5">
                    <td className="py-1">{s.name}</td><td>{s.hetu}</td>
                    <td>{Object.entries(s.byType).map(([k, v]) => `${k}: ${eur(v)}`).join(', ')}</td>
                    <td className="text-right font-mono">{eur(s.withholding)}</td>
                    <td className="text-right font-mono">{s.tyelEmployee ? eur(s.tyelEmployee) : '–'}</td>
                    <td className="text-right font-mono">{s.unemploymentEmployee ? eur(s.unemploymentEmployee) : '–'}</td>
                    <td className="text-xs text-slate-400">{[s.insured.tyel && `TyEL${ins?.tyelPolicy ? ` (${ins.tyelInsurer ?? ''} ${ins.tyelPolicy})` : ''}`, s.insured.unemployment && 'työttömyys', s.insured.health && 'sairausvak.', s.insured.accident && 'tapaturma'].filter(Boolean).join(', ') || 'ei vakuutettavaa ansiota'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Card>
      <Card className="space-y-3">
        <div className="font-semibold">Työnantajan erillisilmoitukset ja maksut Verohallinnolle</div>
        {!q.data?.months.length ? <div className="text-sm text-slate-400">Ei palkanmaksuja.</div> : (
          <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
            <thead><tr className="text-slate-400 text-right"><th className="pb-2 font-medium text-left">Kuukausi</th><th className="pb-2 font-medium">Palkat yht.</th><th className="pb-2 font-medium">Sv-maksun alainen</th><th className="pb-2 font-medium">Sv-maksu 1,91 %</th><th className="pb-2 font-medium">Ennakonpid.</th><th className="pb-2 font-medium">Maksettava</th><th className="pb-2 font-medium text-left pl-4">Määräpäivät</th><th /></tr></thead>
            <tbody className="text-right">
              {q.data.months.map((m) => (
                <tr key={m.key} className="border-t border-white/5">
                  <td className="py-2 text-left">{Number(m.key.slice(5))}/{m.key.slice(0, 4)}</td>
                  <td className="font-mono">{eur(m.wages)}</td><td className="font-mono">{eur(m.healthBase)}</td><td className="font-mono">{eur(m.healthEmployer)}</td>
                  <td className="font-mono">{eur(m.withholding)}</td><td className="font-mono font-semibold">{eur(m.payable)}</td>
                  <td className="text-left pl-4 text-xs">
                    <div className={overdue(m.reportDue, m.reportedAt) ? 'text-red-300' : ''}>Erillisilmoitus {fmtDate(m.reportDue)}{m.reportedAt ? ' ✓' : ''}</div>
                    <div>Maksu (OmaVero) {fmtDate(m.paymentDue)}</div>
                  </td>
                  <td>{canWrite && <button type="button" className={smallButton} onClick={() => markMonth.mutate({ key: m.key, reported: !m.reportedAt })}>{m.reportedAt ? 'Peru' : 'Ilmoitettu'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------- urakkatiedot

const emptyContract = { contractorName: '', contractorBusinessId: '', siteName: '', siteAddress: '', description: '', value: '', billingBasis: 'URAKKA', startDate: today(), endDate: '' };
const thisMonth = () => today().slice(0, 7);

const ContractsTab = ({ companyId, canWrite }: { companyId: string; canWrite: boolean }) => {
  const qc = useQueryClient();
  const [month, setMonth] = useState(thisMonth());
  const [edit, setEdit] = useState<{ id: string | null; f: typeof emptyContract } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['contracts', companyId], queryFn: () => getContracts(companyId) });
  const report = useQuery({ queryKey: ['contractReport', companyId, month], queryFn: () => getContractReport(companyId, month), enabled: /^\d{4}-\d{2}$/.test(month) });
  const refresh = () => { setError(null); qc.invalidateQueries({ queryKey: ['contracts'] }); qc.invalidateQueries({ queryKey: ['contractReport'] }); };
  const save = useMutation({
    mutationFn: () => saveContract(companyId, edit!.id, { ...edit!.f, value: toNum(edit!.f.value), endDate: edit!.f.endDate || null }),
    onSuccess: () => { setEdit(null); refresh(); }, onError: (e) => setError(errText(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => deleteContract(id), onSuccess: refresh, onError: (e) => setError(errText(e)) });
  const mark = useMutation({ mutationFn: (reported: boolean) => markReport(companyId, 'CONTRACTS', month, reported), onSuccess: refresh, onError: (e) => setError(errText(e)) });
  const open = (k: Contract | null) => setEdit(k ? { id: k.id, f: { ...k, siteAddress: k.siteAddress ?? '', description: k.description ?? '', value: fi(k.value), endDate: k.endDate ?? '' } } : { id: null, f: { ...emptyContract } });
  const f = edit?.f;
  const setF = (patch: Partial<typeof emptyContract>) => setEdit({ ...edit!, f: { ...edit!.f, ...patch } });
  return (
    <div className="space-y-4">
      <InfoBox>
        Kun taloyhtiö tilaa rakennustyötä (esim. putki- tai julkisivuremontti) ja sopimuksen arvo on yli 15 000 € (alv 0),
        urakoitsijan tiedot ilmoitetaan Verohallinnolle kuukausittain: ensimmäisen kerran työn alkaessa ja sen jälkeen
        laskutuskuukausilta. Määräpäivä on raportointikuukautta seuraavan toisen kuukauden 5. päivä. Ilmoitus annetaan OmaVerossa.
        Laskutettu määrä lasketaan urakoitsijan Y-tunnuksella kirjatuista ostolaskuista.
      </InfoBox>
      <ErrorBox text={error} />
      {canWrite && !edit && <button type="button" className={primary} onClick={() => open(null)}><Plus className="w-4 h-4 inline" /> Lisää urakka</button>}
      {edit && f && (
        <Card className="space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Urakoitsija"><input aria-label="Urakoitsija" className={inputClass} value={f.contractorName} onChange={(e) => setF({ contractorName: e.target.value })} /></Field>
            <Field label="Urakoitsijan Y-tunnus"><input aria-label="Urakoitsijan Y-tunnus" className={inputClass} value={f.contractorBusinessId} onChange={(e) => setF({ contractorBusinessId: e.target.value })} /></Field>
            <Field label="Sopimuksen arvo € (alv 0)"><input aria-label="Sopimuksen arvo" className={inputClass} value={f.value} onChange={(e) => setF({ value: e.target.value })} /></Field>
            <Field label="Työmaa"><input aria-label="Työmaa" className={inputClass} value={f.siteName} placeholder="esim. Putkiremontti A–C" onChange={(e) => setF({ siteName: e.target.value })} /></Field>
            <Field label="Työmaan osoite"><input className={inputClass} value={f.siteAddress} onChange={(e) => setF({ siteAddress: e.target.value })} /></Field>
            <Field label="Laskutusperuste">
              <select className={inputClass} value={f.billingBasis} onChange={(e) => setF({ billingBasis: e.target.value })}>
                <option value="URAKKA">Urakkalaskutus</option><option value="TUNTI">Tuntilaskutus</option>
              </select>
            </Field>
            <Field label="Aloituspäivä"><input type="date" className={inputClass} value={f.startDate} onChange={(e) => setF({ startDate: e.target.value })} /></Field>
            <Field label="Päättymispäivä (arvio)"><input type="date" className={inputClass} value={f.endDate} onChange={(e) => setF({ endDate: e.target.value })} /></Field>
            <Field label="Kuvaus"><input className={inputClass} value={f.description} onChange={(e) => setF({ description: e.target.value })} /></Field>
          </div>
          <div className="flex gap-2">
            <button type="button" className={primary} disabled={save.isPending} onClick={() => save.mutate()}>Tallenna</button>
            <button type="button" className={smallButton} onClick={() => setEdit(null)}>Peruuta</button>
          </div>
        </Card>
      )}
      <Card>
        <div className="font-semibold mb-2">Urakat</div>
        {!list.data?.length ? <div className="text-sm text-slate-400">Ei urakoita.</div> : (
          <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
            <thead><tr className="text-slate-400 text-left"><th className="pb-2 font-medium">Urakoitsija</th><th className="pb-2 font-medium">Työmaa</th><th className="pb-2 font-medium text-right">Arvo (alv 0)</th><th className="pb-2 font-medium">Aika</th><th /></tr></thead>
            <tbody>
              {list.data.map((k) => (
                <tr key={k.id} className="border-t border-white/5">
                  <td className="py-2">{k.contractorName}<div className="text-xs text-slate-500">{k.contractorBusinessId}</div></td>
                  <td>{k.siteName}</td>
                  <td className="text-right font-mono">{eur(k.value)}{k.value <= 15000 && <div className="text-xs text-slate-500 font-sans">alle rajan, ei ilmoiteta</div>}</td>
                  <td>{fmtDate(k.startDate)}–{k.endDate ? fmtDate(k.endDate) : ''}</td>
                  <td className="text-right space-x-2">
                    {canWrite && <button type="button" className={smallButton} onClick={() => open(k)}>Muokkaa</button>}
                    {canWrite && <button type="button" className={smallButton} onClick={() => remove.mutate(k.id)}>Poista</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="font-semibold">Kuukauden urakkatiedot</div>
          <input type="month" aria-label="Kuukausi" className={inputClass} value={month} onChange={(e) => setMonth(e.target.value)} />
          {report.data && (report.data.reportedAt
            ? <span className="text-emerald-300 text-sm flex items-center gap-1"><CheckCircle className="w-4 h-4" />Ilmoitettu {fmtDate(report.data.reportedAt)}</span>
            : report.data.rows.length > 0 && <span className={`text-sm ${overdue(report.data.due, null) ? 'text-red-300' : 'text-amber-300'}`}>Viimeistään {fmtDate(report.data.due)}</span>)}
          <div className="flex-1" />
          {canWrite && report.data && report.data.rows.length > 0 && (
            <button type="button" className={smallButton} onClick={() => mark.mutate(!report.data!.reportedAt)}>{report.data.reportedAt ? 'Peru merkintä' : 'Merkitse ilmoitetuksi'}</button>
          )}
        </div>
        {!report.data?.rows.length ? <div className="text-sm text-slate-400">Ei ilmoitettavaa tältä kuukaudelta.</div> : (
          <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
            <thead><tr className="text-slate-400 text-left"><th className="pb-2 font-medium">Urakoitsija</th><th className="pb-2 font-medium">Työmaa</th><th className="pb-2 font-medium">Peruste</th><th className="pb-2 font-medium text-right">Sopimus</th><th className="pb-2 font-medium text-right">Laskutettu kk (alv 0)</th><th className="pb-2 font-medium">Huom.</th></tr></thead>
            <tbody>
              {report.data.rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="py-2">{r.contractorName}<div className="text-xs text-slate-500">{r.contractorBusinessId}</div></td>
                  <td>{r.siteName}{r.siteAddress ? <div className="text-xs text-slate-500">{r.siteAddress}</div> : null}</td>
                  <td>{r.billingBasis === 'TUNTI' ? 'Tunti' : 'Urakka'}</td>
                  <td className="text-right font-mono">{eur(r.value)}</td>
                  <td className="text-right font-mono">{eur(r.invoiced)}</td>
                  <td className="text-xs">{[r.starts && `alkaa ${fmtDate(r.startDate)}`, r.ends && 'päättyy', `${r.invoiceCount} laskua`].filter(Boolean).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------- asetukset

const RATE_FIELDS: { key: keyof Rates; label: string }[] = [
  { key: 'tyelTotal', label: 'TyEL yhteensä %' }, { key: 'tyelEmployee', label: 'TyEL työntekijä %' },
  { key: 'unemploymentEmployer', label: 'Työttömyysvak. työnantaja %' }, { key: 'unemploymentEmployee', label: 'Työttömyysvak. työntekijä %' },
  { key: 'healthEmployer', label: 'Työnantajan sv-maksu %' }, { key: 'accident', label: 'Tapaturmavakuutus %' },
];

const SettingsTab = ({ companyId, canManage }: { companyId: string; canManage: boolean }) => {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payrollSettings', companyId], queryFn: () => getPayrollSettings(companyId) });
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) {
      const s = q.data.settings;
      setDraft({ ...Object.fromEntries(RATE_FIELDS.map((r) => [r.key, fi(s.rates[r.key])])), tyelInsurer: s.tyelInsurer ?? '', tyelPolicy: s.tyelPolicy ?? '' });
    }
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => savePayrollSettings({
      companyId, ...(Object.fromEntries(RATE_FIELDS.map((r) => [r.key, toNum(draft![r.key])])) as unknown as Rates),
      tyelInsurer: draft!.tyelInsurer || null, tyelPolicy: draft!.tyelPolicy || null,
    }),
    onSuccess: () => { setError(null); setMsg('Tallennettu'); qc.invalidateQueries({ queryKey: ['payrollSettings'] }); setTimeout(() => setMsg(null), 4000); },
    onError: (e) => setError(errText(e)),
  });
  if (!q.data || !draft) return <div className="glass-card h-40 animate-pulse" />;
  return (
    <Card className="space-y-4">
      <InfoBox>
        Oletukset ovat vuoden {q.data.ratesYear} lakisääteisiä maksuja. Taloyhtiö on yleensä TyEL:n tilapäinen työnantaja
        (25,85 %); jos yhtiöllä on TyEL-sopimus, käytä vakuutusyhtiön ilmoittamaa prosenttia. Tapaturmavakuutuksen
        prosentti on vakuutusyhtiökohtainen. Kokouspalkkioista ei makseta näitä maksuja lainkaan.
      </InfoBox>
      <div className="grid md:grid-cols-3 gap-3">
        {RATE_FIELDS.map((r) => (
          <Field key={r.key} label={`${r.label} (oletus ${fi(q.data.defaults[r.key])})`}>
            <input className={inputClass} disabled={!canManage} value={draft[r.key]} onChange={(e) => setDraft({ ...draft, [r.key]: e.target.value })} />
          </Field>
        ))}
        <Field label="Työeläkeyhtiö"><input className={inputClass} disabled={!canManage} value={draft.tyelInsurer} onChange={(e) => setDraft({ ...draft, tyelInsurer: e.target.value })} /></Field>
        <Field label="TyEL-vakuutusnumero"><input className={inputClass} disabled={!canManage} value={draft.tyelPolicy} onChange={(e) => setDraft({ ...draft, tyelPolicy: e.target.value })} /></Field>
      </div>
      {canManage && <button type="button" className={primary} disabled={save.isPending} onClick={() => save.mutate()}>Tallenna</button>}
      {msg && <span className="ml-3 text-emerald-300 text-sm">{msg}</span>}
      <ErrorBox text={error} />
    </Card>
  );
};

/** Palkat ja palkkiot, tulorekisteri-ilmoitukset ja rakentamisen urakkatiedot (moduuli 9). */
const PayrollPage = () => {
  const { selectedCompany, canWrite, canManage } = useCompany();
  const companyId = selectedCompany?.id as string | undefined;
  const [tab, setTab] = useState<Tab>('runs');
  const payeesQ = useQuery({ queryKey: ['payees', companyId], queryFn: () => getPayees(companyId!), enabled: !!companyId });
  const payees = useMemo(() => payeesQ.data ?? [], [payeesQ.data]);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Palkat ja palkkiot</h2>
        <p className="text-slate-400 mt-1">Hallituksen kokouspalkkiot ja pienet palkat, tulorekisteri-ilmoitukset ja rakentamisen urakkatiedot.</p>
      </div>
      <div className="flex flex-wrap gap-1 p-1 bg-slate-900/50 border border-white/5 rounded-xl w-fit">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab === t.key ? 'bg-primary-500 text-white' : 'text-slate-400 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {payeesQ.error && <ErrorBox text={`Tietoja ei saatu haettua: ${errText(payeesQ.error)}`} />}
      {companyId && tab === 'runs' && <RunsTab companyId={companyId} canWrite={canWrite} canManage={canManage} payees={payees} />}
      {companyId && tab === 'payees' && <PayeesTab companyId={companyId} payees={payees} canWrite={canWrite} />}
      {companyId && tab === 'reports' && <ReportsTab companyId={companyId} canWrite={canWrite} />}
      {companyId && tab === 'contracts' && <ContractsTab companyId={companyId} canWrite={canWrite} />}
      {companyId && tab === 'settings' && <SettingsTab companyId={companyId} canManage={canManage} />}
    </div>
  );
};

export default PayrollPage;
