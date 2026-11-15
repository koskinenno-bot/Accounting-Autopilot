import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, Trash2 } from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import { deleteBankBalance, getBankReconciliation, markBankReconciled, saveBankBalance } from '../api/accounting';
import type { ReconMonth } from '../api/accounting';
import { ErrorBox, InfoBox, eur, fmtDate, inputClass, smallButton } from '../components/fees/common';

const errText = (err: any) => err?.response?.data?.error || err?.message || 'Toiminto epäonnistui';
const SOURCE: Record<string, string> = { PSD2: 'pankkiyhteys', CAMT: 'tiliote', MANUAL: 'käsin' };
const monthLabel = (key: string) => `${Number(key.slice(5))}/${key.slice(0, 4)}`;
const fmtIban = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();

const StatusCell = ({ m }: { m: ReconMonth }) => {
  if (m.reconciledAt) return <span className="text-emerald-300 flex items-center gap-1"><CheckCircle className="w-4 h-4" />Täsmäytetty</span>;
  if (m.status === 'OK') return <span className="text-emerald-300">Täsmää</span>;
  if (m.status === 'NO_BALANCE') return <span className="text-slate-400">Pankkisaldo puuttuu</span>;
  if (m.status === 'STALE') return <span className="text-amber-300">Saldo ei kuun lopulta</span>;
  return <span className="text-red-300 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />Ero {eur(m.difference ?? 0)}</span>;
};

/** Pankkitäsmäytys: pankkien saldot vs. kirjanpidon rahatilit kuukauden lopussa. */
const BankReconciliationPage = () => {
  const { selectedCompany, canWrite } = useCompany();
  const companyId = selectedCompany?.id as string | undefined;
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ iban: '', date: '', balance: '' });
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['bankRecon', companyId, year], queryFn: () => getBankReconciliation(companyId!, year), enabled: !!companyId });
  const refresh = () => { setError(null); qc.invalidateQueries({ queryKey: ['bankRecon'] }); };
  const save = useMutation({
    mutationFn: () => saveBankBalance(companyId!, form.iban, form.date, Number(form.balance.replace(',', '.').replace(/\s/g, ''))),
    onSuccess: () => { setForm({ ...form, balance: '' }); refresh(); }, onError: (e) => setError(errText(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => deleteBankBalance(id), onSuccess: refresh, onError: (e) => setError(errText(e)) });
  const mark = useMutation({ mutationFn: (v: { key: string; on: boolean }) => markBankReconciled(companyId!, v.key, v.on), onSuccess: refresh, onError: (e) => setError(errText(e)) });
  const ibans = [...new Set((q.data?.balances ?? []).map((b) => b.iban))];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Pankkitäsmäytys</h2>
          <p className="text-slate-400 mt-1">Pankkitilien saldot verrattuna kirjanpidon rahatileihin (1900–1989) kuukauden lopussa.</p>
        </div>
        <select aria-label="Vuosi" className={inputClass} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[0, 1, 2].map((d) => new Date().getFullYear() - d).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <InfoBox>
        Saldot tulevat automaattisesti pankkiyhteydestä ja camt.053-tiliotteen loppusaldosta. Jos niitä ei ole,
        syötä kuukauden viimeisen päivän saldo tiliotteelta käsin. Ero johtuu yleensä hyväksymättömistä vienneistä
        tai puuttuvasta tiliotteesta. Tilinpäätöspäivän täsmäytetty saldo kuuluu tase-erittelyyn.
      </InfoBox>
      <ErrorBox text={error} />
      <div className="glass-card p-5 overflow-x-auto">
        {q.error ? <ErrorBox text={errText(q.error)} /> : !q.data ? <div className="h-32 animate-pulse" /> : (
          <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
            <thead>
              <tr className="text-slate-400 text-right">
                <th className="pb-2 font-medium text-left">Kuukausi</th><th className="pb-2 font-medium">Pankit</th><th className="pb-2 font-medium">Kirjanpito</th>
                <th className="pb-2 font-medium text-left">Tila</th><th className="pb-2 font-medium text-left">Hyväksymättömät</th><th />
              </tr>
            </thead>
            <tbody>
              {q.data.months.map((m) => (
                <Fragment key={m.key}>
                  <tr className="border-t border-white/5">
                    <td className="py-2">
                      <button type="button" className="hover:text-white text-left" onClick={() => setOpen(open === m.key ? null : m.key)}>
                        {monthLabel(m.key)}{m.current && <span className="text-xs text-slate-500 whitespace-nowrap"> (tähän asti {fmtDate(m.date)})</span>}
                      </button>
                    </td>
                    <td className="text-right font-mono whitespace-nowrap">{m.accounts.length ? eur(m.bank) : '–'}</td>
                    <td className="text-right font-mono whitespace-nowrap">{eur(m.book)}</td>
                    <td className="whitespace-nowrap"><StatusCell m={m} /></td>
                    <td className="text-xs text-slate-400">{m.drafts.count ? `${m.drafts.count} riviä, netto ${eur(m.drafts.net)}` : '–'}
                      {m.status === 'DIFFERENCE' && m.drafts.count > 0 && Math.abs((m.difference ?? 0) - m.drafts.net) < 0.005 && <div className="text-amber-300">Ero selittyy näillä – hyväksy viennit</div>}</td>
                    <td className="text-right whitespace-nowrap space-x-2">
                      <button type="button" className={smallButton} onClick={() => setOpen(open === m.key ? null : m.key)}>Tilit</button>
                      {canWrite && !m.current && (m.reconciledAt
                        ? <button type="button" className={smallButton} onClick={() => mark.mutate({ key: m.key, on: false })}>Peru</button>
                        : m.status === 'OK' && <button type="button" className={smallButton} onClick={() => mark.mutate({ key: m.key, on: true })}>Merkitse täsmäytetyksi</button>)}
                    </td>
                  </tr>
                  {open === m.key && (
                    <tr key={`${m.key}-d`} className="bg-white/[0.02]">
                      <td colSpan={6} className="py-2">
                        {!m.accounts.length ? <span className="text-slate-400 text-xs">Ei saldoja tältä ajalta.</span> : m.accounts.map((a) => (
                          <div key={a.iban} className="flex gap-4 text-xs py-0.5">
                            <span className="font-mono w-56">{fmtIban(a.iban)}</span>
                            <span className="font-mono w-28 text-right">{eur(a.balance)}</span>
                            <span className={a.stale ? 'text-amber-300' : 'text-slate-400'}>{fmtDate(a.date)} ({SOURCE[a.source] ?? a.source}){a.stale ? ', ei kuun lopulta' : ''}</span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canWrite && (
        <div className="glass-card p-5 space-y-3">
          <div className="font-semibold">Syötä saldo tiliotteelta</div>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <label className="flex flex-col gap-1 text-sm"><span className="text-slate-400">Tilinumero (IBAN)</span>
              <input aria-label="IBAN" list="ibans" className={`${inputClass} w-64`} value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} required />
              <datalist id="ibans">{ibans.map((i) => <option key={i} value={i} />)}</datalist>
            </label>
            <label className="flex flex-col gap-1 text-sm"><span className="text-slate-400">Päivä</span>
              <input aria-label="Päivä" type="date" className={inputClass} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </label>
            <label className="flex flex-col gap-1 text-sm"><span className="text-slate-400">Saldo €</span>
              <input aria-label="Saldo" className={`${inputClass} w-36 text-right`} value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} required />
            </label>
            <button type="submit" disabled={save.isPending} className="premium-button premium-gradient text-white disabled:opacity-50">Tallenna</button>
          </form>
          {!!q.data?.balances.length && (
            <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
              <thead><tr className="text-slate-400 text-left"><th className="pb-1 font-medium">Tili</th><th className="pb-1 font-medium">Päivä</th><th className="pb-1 font-medium text-right">Saldo</th><th className="pb-1 font-medium">Lähde</th><th /></tr></thead>
              <tbody>
                {q.data.balances.map((b) => (
                  <tr key={b.id} className="border-t border-white/5">
                    <td className="py-1 font-mono text-xs">{fmtIban(b.iban)}</td><td>{fmtDate(b.date)}</td>
                    <td className="text-right font-mono whitespace-nowrap">{eur(b.balance)}</td><td className="text-slate-400">{SOURCE[b.source] ?? b.source}</td>
                    <td className="text-right">{b.source === 'MANUAL' && (
                      <button type="button" aria-label="Poista saldo" className="text-slate-500 hover:text-red-300" onClick={() => remove.mutate(b.id)}><Trash2 className="w-4 h-4" /></button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

export default BankReconciliationPage;
