import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { runFees } from '../../api/fees';
import type { FeeRunRow } from '../../api/fees';
import { ErrorBox, InfoBox, eur, errorText, inputClass, isoDay } from './common';

const nextMonth = () => {
  const d = new Date();
  const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Laskutusajo: esikatselu huoneistoittain, sitten laskujen luonti yhdellä napilla. */
const RunTab = ({ companyId, canWrite }: { companyId: string; canWrite: boolean }) => {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(nextMonth());
  const [issueDate, setIssueDate] = useState(isoDay(new Date()));
  const [dueDate, setDueDate] = useState(`${nextMonth()}-05`);
  const [preview, setPreview] = useState<{ rows: FeeRunRow[]; count: number; total: number; alreadyBilled: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changePeriod = (p: string) => {
    setPeriod(p);
    if (/^\d{4}-\d{2}$/.test(p)) setDueDate(`${p}-05`);
    setPreview(null);
    setResult(null);
  };

  const run = useMutation({
    mutationFn: (dryRun: boolean) => runFees({ companyId, period, issueDate, dueDate, dryRun }),
    onSuccess: (data, dryRun) => {
      setError(null);
      if (dryRun) {
        setPreview({ rows: data.rows ?? [], count: data.count ?? 0, total: data.total, alreadyBilled: data.alreadyBilled });
        setResult(null);
      } else {
        setPreview(null);
        setResult(`Luotiin ${data.created} vastikelaskua, yhteensä ${eur(data.total)}. Laskut näkyvät reskontrassa ja kirjanpidon käsittelemättömissä.`);
        queryClient.invalidateQueries({ queryKey: ['reskontra', companyId] });
      }
    },
    onError: (err) => setError(errorText(err)),
  });

  return (
    <div className="space-y-4">
      <div className="glass-card p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm space-y-1">
            <div className="text-slate-400">Kausi</div>
            <input type="month" className={inputClass} value={period} onChange={(e) => changePeriod(e.target.value)} />
          </label>
          <label className="text-sm space-y-1">
            <div className="text-slate-400">Laskupäivä</div>
            <input type="date" className={inputClass} value={issueDate} onChange={(e) => { setIssueDate(e.target.value); setPreview(null); }} />
          </label>
          <label className="text-sm space-y-1">
            <div className="text-slate-400">Eräpäivä</div>
            <input type="date" className={inputClass} value={dueDate} onChange={(e) => { setDueDate(e.target.value); setPreview(null); }} />
          </label>
          <button type="button" className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-semibold hover:text-white"
            disabled={run.isPending} onClick={() => run.mutate(true)}>
            Esikatsele
          </button>
          {preview && canWrite && preview.count > 0 && (
            <button type="button" className="premium-button premium-gradient text-white" disabled={run.isPending} onClick={() => run.mutate(false)}>
              Luo {preview.count} laskua ({eur(preview.total)})
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500">
          Vastikkeet lasketaan Perusteet-välilehden hinnoista ja osakasluettelon huoneistotiedoista. Kaudelle jo laskutetut
          huoneistot ohitetaan, joten ajon voi tehdä uudelleen esimerkiksi uuden osakkaan lisäämisen jälkeen.
        </p>
      </div>
      <ErrorBox text={error} />
      {result && <InfoBox>{result}</InfoBox>}
      {preview && (
        <div className="glass-card overflow-x-auto">
          <div className="p-4 text-sm text-slate-300">
            {preview.count} huoneistoa laskutetaan, yhteensä <span className="font-semibold">{eur(preview.total)}</span>
            {preview.alreadyBilled > 0 && `, ${preview.alreadyBilled} on jo laskutettu tältä kaudelta`}.
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-y border-white/5">
                <th className="p-3 font-medium">Huoneisto</th>
                <th className="p-3 font-medium">Maksaja</th>
                <th className="p-3 font-medium">Erittely</th>
                <th className="p-3 font-medium text-right">Yhteensä</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.apartment} className={`border-b border-white/5 align-top ${r.alreadyBilled ? 'opacity-50' : ''}`}>
                  <td className="p-3 font-semibold">{r.apartment}</td>
                  <td className="p-3">
                    {r.recipientName}
                    {!r.recipientEmail && <div className="text-xs text-amber-300">Ei sähköpostia</div>}
                  </td>
                  <td className="p-3 text-slate-400">
                    {r.lines.map((l) => (
                      <div key={l.description}>
                        {l.description}: {l.quantity.toLocaleString('fi-FI')} × {l.unitPrice.toLocaleString('fi-FI', { maximumFractionDigits: 4 })} € = {eur(l.amount)}
                      </div>
                    ))}
                    {r.exempted.map((x) => <div key={x} className="text-xs text-emerald-400">{x}: lainaosuus maksettu pois</div>)}
                    {r.alreadyBilled && <div className="text-xs">Laskutettu jo tältä kaudelta</div>}
                  </td>
                  <td className="p-3 text-right font-mono">{eur(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default RunTab;
