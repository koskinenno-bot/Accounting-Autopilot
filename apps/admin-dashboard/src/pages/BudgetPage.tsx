import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCompany } from '../hooks/useCompany';
import FiscalYearSelect, { fiscalYearLabel } from '../components/FiscalYearSelect';
import { getBudget, saveBudget } from '../api/accounting';
import { ErrorBox, InfoBox, eur, inputClass, smallButton } from '../components/fees/common';

const errText = (err: any) => err?.response?.data?.error || err?.message || 'Toiminto epäonnistui';
const parse = (s: string) => {
  const n = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const show = (n: number | undefined) => (n ? String(n).replace('.', ',') : '');
const isIncome = (acc: string) => acc < '4000';

/** Talousarvio tileittäin: edellisen kauden toteuma, arvio ja kuluvan kauden toteuma. Summat luonnollisella etumerkillä. */
const BudgetPage = () => {
  const { selectedCompany, canWrite } = useCompany();
  const companyId = selectedCompany?.id as string | undefined;
  const queryClient = useQueryClient();
  const [fyId, setFyId] = useState<string>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [raise, setRaise] = useState('0');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['budget', fyId], queryFn: () => getBudget(fyId!), enabled: !!fyId });
  useEffect(() => {
    if (data) setValues(Object.fromEntries(data.lines.map((l) => [l.accountNumber, show(l.amount)])));
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      const lines = Object.entries(values).filter(([, v]) => v.trim()).map(([accountNumber, v]) => ({ accountNumber, amount: parse(v) }));
      const bad = lines.find((l) => Number.isNaN(l.amount));
      if (bad) throw new Error(`Tilin ${bad.accountNumber} summa on virheellinen`);
      return saveBudget(fyId!, lines);
    },
    onSuccess: (r) => {
      setError(null);
      setMessage(`Talousarvio tallennettu (${r.saved} tiliä)`);
      setTimeout(() => setMessage(null), 4000);
      queryClient.invalidateQueries({ queryKey: ['budget', fyId] });
      queryClient.invalidateQueries({ queryKey: ['closingPackage'] });
    },
    onError: (err) => setError(errText(err)),
  });

  const rows = useMemo(() => {
    if (!data) return [];
    return data.accounts
      .filter((a) => showAll ? a.isActive : (values[a.accountNumber]?.trim() || data.actual[a.accountNumber] || data.previous[a.accountNumber]))
      .map((a) => ({ ...a, budget: parse(values[a.accountNumber] || '0') || 0, actual: data.actual[a.accountNumber] ?? 0, previous: data.previous[a.accountNumber] ?? 0 }));
  }, [data, values, showAll]);

  const totals = (income: boolean) => rows.filter((r) => isIncome(r.accountNumber) === income)
    .reduce((t, r) => ({ budget: t.budget + r.budget, actual: t.actual + r.actual, previous: t.previous + r.previous }), { budget: 0, actual: 0, previous: 0 });
  const inc = totals(true);
  const exp = totals(false);

  const fillFromPrevious = () => {
    if (!data) return;
    const pct = parse(raise) || 0;
    const next = { ...values };
    for (const a of data.accounts) {
      const prev = data.previous[a.accountNumber];
      if (!prev || next[a.accountNumber]?.trim()) continue;
      const v = isIncome(a.accountNumber) ? prev : prev * (1 + pct / 100);
      next[a.accountNumber] = show(Math.round(v));
    }
    setValues(next);
  };

  const readOnly = !canWrite;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '–');

  const section = (title: string, income: boolean) => {
    const list = rows.filter((r) => isIncome(r.accountNumber) === income);
    const t = income ? inc : exp;
    return (
      <>
        <tr><td colSpan={6} className="px-3 pt-4 pb-1 font-semibold">{title}</td></tr>
        {list.map((r) => {
          const diff = r.actual - r.budget;
          const bad = income ? diff < 0 : diff > 0;
          return (
            <tr key={r.accountNumber} className="border-b border-white/5">
              <td className="px-3 py-1.5">{r.accountNumber} {r.accountName}</td>
              <td className="px-3 py-1.5 text-right font-mono text-slate-400">{eur(r.previous)}</td>
              <td className="px-3 py-1.5 text-right">
                <input className={`${inputClass} w-32 text-right font-mono py-1`} value={values[r.accountNumber] ?? ''} readOnly={readOnly}
                  aria-label={`Talousarvio ${r.accountNumber}`} placeholder="0"
                  onChange={(e) => setValues({ ...values, [r.accountNumber]: e.target.value })} />
              </td>
              <td className="px-3 py-1.5 text-right font-mono">{eur(r.actual)}</td>
              <td className={`px-3 py-1.5 text-right font-mono ${r.budget && bad ? 'text-rose-300' : 'text-slate-400'}`}>{r.budget ? eur(diff) : '–'}</td>
              <td className="px-3 py-1.5 text-right text-slate-400">{pct(r.actual, r.budget)}</td>
            </tr>
          );
        })}
        <tr className="font-semibold border-b border-white/10">
          <td className="px-3 py-2">{title} yhteensä</td>
          <td className="px-3 py-2 text-right font-mono">{eur(t.previous)}</td>
          <td className="px-3 py-2 text-right font-mono">{eur(t.budget)}</td>
          <td className="px-3 py-2 text-right font-mono">{eur(t.actual)}</td>
          <td className="px-3 py-2 text-right font-mono">{eur(t.actual - t.budget)}</td>
          <td className="px-3 py-2 text-right">{pct(t.actual, t.budget)}</td>
        </tr>
      </>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Talousarvio</h2>
          <p className="text-slate-400 mt-1">Talousarvio tileittäin ja toteuman vertailu. Vertailu tulostuu toimintakertomukseen.</p>
        </div>
        <FiscalYearSelect companyId={companyId} value={fyId} onChange={setFyId} />
      </div>

      {isLoading && <div className="glass-card h-64 animate-pulse" />}
      {data && (
        <>
          <InfoBox>
            Tuotot ja kulut kirjoitetaan positiivisina euroina. Edellisen kauden toteuma ({data.previousFiscalYear ? fiscalYearLabel(data.previousFiscalYear) : 'ei edellistä kautta'})
            on pohjana; ero on toteuma miinus arvio, punaisella kun tulos heikkenee.
          </InfoBox>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[['Tuotot', inc], ['Kulut', exp]].map(([label, t]: any) => (
              <div key={label} className="glass-card p-4">
                <div className="text-sm text-slate-400">{label}</div>
                <div className="text-xl font-bold mt-1">{eur(t.actual)}</div>
                <div className="text-xs text-slate-500">arvio {eur(t.budget)} · {pct(t.actual, t.budget)}</div>
              </div>
            ))}
            <div className="glass-card p-4">
              <div className="text-sm text-slate-400">Tulos</div>
              <div className={`text-xl font-bold mt-1 ${inc.actual - exp.actual < 0 ? 'text-rose-300' : ''}`}>{eur(inc.actual - exp.actual)}</div>
              <div className="text-xs text-slate-500">arvio {eur(inc.budget - exp.budget)}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {!readOnly && (
              <>
                <button type="button" className={smallButton} onClick={fillFromPrevious} disabled={!data.previousFiscalYear}>Täytä tyhjät edellisen kauden toteumalla</button>
                <label className="text-sm text-slate-400 flex items-center gap-2">
                  kulujen korotus
                  <input className={`${inputClass} w-16 text-right py-1`} value={raise} onChange={(e) => setRaise(e.target.value)} aria-label="Korotus %" /> %
                </label>
              </>
            )}
            <label className="text-sm text-slate-300 flex items-center gap-2 ml-auto">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Näytä kaikki tilit
            </label>
          </div>
          <div className="glass-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-white/5">
                  <th className="p-3 font-medium">Tili</th>
                  <th className="p-3 font-medium text-right">Edellinen kausi</th>
                  <th className="p-3 font-medium text-right">Talousarvio</th>
                  <th className="p-3 font-medium text-right">Toteuma</th>
                  <th className="p-3 font-medium text-right">Ero</th>
                  <th className="p-3 font-medium text-right">Toteutunut</th>
                </tr>
              </thead>
              <tbody>
                {section('Tuotot', true)}
                {section('Kulut', false)}
                <tr className="font-bold">
                  <td className="px-3 py-3">Tulos</td>
                  <td className="px-3 py-3 text-right font-mono">{eur(inc.previous - exp.previous)}</td>
                  <td className="px-3 py-3 text-right font-mono">{eur(inc.budget - exp.budget)}</td>
                  <td className="px-3 py-3 text-right font-mono">{eur(inc.actual - exp.actual)}</td>
                  <td className="px-3 py-3 text-right font-mono">{eur((inc.actual - exp.actual) - (inc.budget - exp.budget))}</td>
                  <td />
                </tr>
              </tbody>
            </table>
            {!rows.length && <div className="p-8 text-center text-slate-400">Ei vielä toteumaa eikä arviota. Valitse "Näytä kaikki tilit" ja kirjoita arviot.</div>}
          </div>
          <ErrorBox text={error} />
          {!readOnly && (
            <div className="flex items-center gap-3">
              <button type="button" className="premium-button premium-gradient text-white disabled:opacity-50" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? 'Tallennetaan…' : 'Tallenna talousarvio'}
              </button>
              {message && <span className="text-sm text-emerald-300">{message}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default BudgetPage;
