import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle, AlertTriangle, Lock, Upload, Plus } from 'lucide-react';
import { getCompanies } from '../api/companies';
import {
  closeFiscalYear, createAccrual, createAsset, getAccounts, getAccruals, getAssets, getClosingChecklist,
  getDepreciation, postDepreciation, setOpeningBalances,
} from '../api/accounting';
import FiscalYearSelect, { fiscalYearLabel } from '../components/FiscalYearSelect';

const eur = (n: number | string) => `${Number(n).toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const errorText = (err: any) => err?.response?.data?.error || err?.message || 'Tuntematon virhe';
const input = 'bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm';
const button = 'px-4 py-2 rounded-xl border border-white/10 text-slate-200 hover:bg-white/5 text-sm font-semibold disabled:opacity-40';

/** "tili;nimi;saldo" (tai pilkku/sarkain), desimaalipilkku sallittu. Otsikkorivi ohitetaan. */
export const parseOpeningCsv = (text: string) =>
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).flatMap((line) => {
    const parts = line.split(/[;\t]|,(?=\s*-?[\d ]+(?:[.,]\d+)?\s*$)/).map((p) => p.trim());
    const [accountNumber, ...rest] = parts;
    if (!/^\d{4}$/.test(accountNumber || '')) return []; // otsikko tai tyhjä
    const raw = rest[rest.length - 1] || '';
    const balance = Number(raw.replace(/\s/g, '').replace(',', '.'));
    const name = rest.length > 1 ? rest.slice(0, -1).join(' ') : undefined;
    return Number.isFinite(balance) ? [{ accountNumber, name, balance }] : [];
  });

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="glass-card p-6 space-y-4">
    <h3 className="text-lg font-bold">{title}</h3>
    {children}
  </div>
);

const ClosingPage = () => {
  const queryClient = useQueryClient();
  const [fyId, setFyId] = useState<string>();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [ack, setAck] = useState(false);
  const [openingText, setOpeningText] = useState('');
  const [depAmounts, setDepAmounts] = useState<Record<string, string>>({});
  const [assetForm, setAssetForm] = useState({ name: 'Rakennus', accountNumber: '1010', acquisitionDate: '', acquisitionCost: '', priorDepreciation: '0', method: 'DECLINING', rate: '4', usefulLifeYears: '', manualAmount: '' });
  const [accrualForm, setAccrualForm] = useState({ kind: 'accrued_expense', accountNumber: '', amount: '', description: '' });

  const { data: companies } = useQuery({ queryKey: ['companies'], queryFn: getCompanies });
  const companyId: string | undefined = companies?.[0]?.id;
  const enabled = !!fyId;
  const checklist = useQuery({ queryKey: ['closing', fyId], queryFn: () => getClosingChecklist(fyId!), enabled });
  const depreciation = useQuery({ queryKey: ['depreciation', fyId], queryFn: () => getDepreciation(fyId!), enabled });
  const accruals = useQuery({ queryKey: ['accruals', fyId], queryFn: () => getAccruals(fyId!), enabled });
  const accounts = useQuery({ queryKey: ['accounts', companyId], queryFn: () => getAccounts(companyId!), enabled: !!companyId });
  useQuery({ queryKey: ['assets', companyId], queryFn: () => getAssets(companyId!), enabled: !!companyId });

  const fy = checklist.data?.fiscalYear;
  const closed = fy?.status === 'CLOSED';
  const items: any[] = checklist.data?.items || [];
  const blockingFailed = items.some((i) => i.blocking && !i.ok);
  const warnings = items.filter((i) => !i.blocking && !i.ok);
  const openingDone = items.find((i) => i.key === 'opening')?.ok;

  // Ilmoitus näytetään siinä kortissa, jossa toiminto tehtiin (sivun yläreuna jää usein näkymättömiin)
  const [section, setSection] = useState<string>('close');
  const act = (where: string, action: () => Promise<string>) => { setSection(where); setMessage(null); run.mutate(action); };
  const notice = (where: string) => (message && section === where ? (
    <div className={`text-sm rounded-lg p-3 border ${message.ok ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-300 bg-rose-500/10 border-rose-500/20'}`}>
      {message.text}
    </div>
  ) : null);

  const run = useMutation({
    mutationFn: async (action: () => Promise<string>) => action(),
    onSuccess: (text) => {
      setMessage({ ok: true, text });
      ['closing', 'depreciation', 'accruals', 'assets', 'fiscalYears', 'postedLedger', 'income-statement', 'balance-sheet', 'accStats']
        .forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
    },
    onError: (err) => setMessage({ ok: false, text: errorText(err) }),
  });

  const openingRows = parseOpeningCsv(openingText);
  const pendingDep: any[] = (depreciation.data || []).filter((d: any) => !d.postedEntryId);
  const depAmount = (d: any) => Number(String(depAmounts[d.asset.id] ?? d.amount).replace(/\s/g, '').replace(',', '.')) || 0;
  const depTotal = Math.round(pendingDep.reduce((s, d) => s + depAmount(d), 0) * 100) / 100;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Tilikausi ja tilinpäätös</h2>
          <p className="text-slate-400 mt-1">Avaussaldot, poistot, jaksotukset ja tilikauden sulkeminen.</p>
        </div>
        <FiscalYearSelect companyId={companyId} value={fyId} onChange={setFyId} />
      </div>

      <Card title={`Tilinpäätöksen tarkistuslista${fy ? ` – ${fiscalYearLabel(fy)}` : ''}`}>
        {notice('close')}
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.key} className="flex items-start gap-3 text-sm">
              {i.ok ? <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                : i.blocking ? <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                  : <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />}
              <span><span className="font-semibold">{i.label}</span><span className="text-slate-400"> – {i.detail}</span></span>
            </li>
          ))}
        </ul>
        {closed ? (
          <div className="flex items-center gap-2 text-slate-300 text-sm"><Lock className="w-4 h-4" />Tilikausi on suljettu ja viennit lukittu.</div>
        ) : (
          <div className="flex flex-wrap items-center gap-4 pt-2">
            {warnings.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-amber-300">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                Olen tarkistanut varoitukset ({warnings.length})
              </label>
            )}
            <button
              type="button"
              className="premium-button premium-gradient text-white flex items-center gap-2 disabled:opacity-40"
              disabled={!fy || blockingFailed || (warnings.length > 0 && !ack) || run.isPending}
              onClick={() => {
                if (!window.confirm('Suljetaanko tilikausi? Viennit lukitaan, tulos siirretään omaan pääomaan ja seuraava tilikausi avataan. Toimintoa ei voi perua.')) return;
                act('close', async () => {
                  const r = await closeFiscalYear(fyId!, ack);
                  setFyId(r.nextFiscalYear?.id);
                  return `Tilikausi suljettu. Tulos ${eur(r.result)} siirretty tilille 2200, ${r.lockedEntries} vientiä lukittu, seuraava tilikausi avattu${r.openingCreated ? ' avaussaldoineen' : ''}${r.accrualReversals ? `, ${r.accrualReversals} jaksotusta purettu` : ''}.`;
                });
              }}
            >
              <Lock className="w-4 h-4" />Sulje tilikausi
            </button>
          </div>
        )}
      </Card>

      {!closed && (
        <Card title="Avaussaldot">
          {notice('opening')}
          {openingDone ? (
            <p className="text-sm text-slate-300">Avaussaldot on kirjattu ({items.find((i) => i.key === 'opening')?.detail}). Korjaukset tehdään korjausviennillä.</p>
          ) : (
            <>
              <p className="text-sm text-slate-400">Liitä edellisen tilinpäätöksen tase muodossa <code>tili;nimi;saldo</code> (yksi tili per rivi, saldot positiivisina). Vastaavaa ja vastattavaa on oltava yhtä suuret.</p>
              <div className="flex gap-3 items-center">
                <label className={`${button} cursor-pointer inline-flex items-center gap-2`}>
                  <Upload className="w-4 h-4" />Lataa CSV
                  <input type="file" accept=".csv,.txt" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setOpeningText(await f.text()); }} />
                </label>
              </div>
              <textarea className={`${input} w-full h-32 font-mono`} placeholder={'1010;Rakennukset;500000,00\n1900;Pankkitili;30000,00\n2000;Osakepääoma;100000,00\n2500;Lainat rahoituslaitoksilta;430000,00'} value={openingText} onChange={(e) => setOpeningText(e.target.value)} />
              {openingRows.length > 0 && (
                <div className="text-sm text-slate-300">
                  {openingRows.length} riviä · vastaavaa {eur(openingRows.filter((r) => r.accountNumber < '2000').reduce((s, r) => s + r.balance, 0))} ·
                  vastattavaa {eur(openingRows.filter((r) => r.accountNumber >= '2000').reduce((s, r) => s + r.balance, 0))}
                </div>
              )}
              <button type="button" className={button} disabled={!openingRows.length || run.isPending}
                onClick={() => act('opening', async () => { await setOpeningBalances(fyId!, openingRows); setOpeningText(''); return 'Avaussaldot kirjattu.'; })}>
                Kirjaa avaussaldot
              </button>
            </>
          )}
        </Card>
      )}

      <Card title="Käyttöomaisuus ja poistot">
        {(depreciation.data || []).length === 0 && <p className="text-sm text-slate-400">Käyttöomaisuusrekisteri on tyhjä. Lisää rakennus ja muu poistonalainen omaisuus alla.</p>}
        {(depreciation.data || []).map((d: any) => (
          <div key={d.asset.id} className="flex flex-wrap items-center justify-between gap-3 text-sm border-b border-white/5 pb-2">
            <div>
              <div className="font-semibold">{d.asset.name} <span className="text-slate-500">({d.asset.accountNumber})</span></div>
              <div className="text-slate-400">
                {d.asset.method === 'DECLINING' ? `Menojäännös ${d.asset.rate} %` : d.asset.method === 'STRAIGHT_LINE' ? `Tasapoisto ${d.asset.usefulLifeYears} v` : 'Poisto käsin (esim. lainanlyhennysten mukaan)'}
                {' · '}kirjanpitoarvo kauden alussa {eur(d.bookValueStart)}
              </div>
            </div>
            {d.postedEntryId ? <span className="text-emerald-300">Poisto kirjattu</span> : (
              <label className="flex items-center gap-2 text-slate-400">
                Poisto €
                <input className={`${input} w-36 text-right text-slate-100`} disabled={closed} value={depAmounts[d.asset.id] ?? String(d.amount)}
                  onChange={(e) => setDepAmounts({ ...depAmounts, [d.asset.id]: e.target.value })} />
              </label>
            )}
          </div>
        ))}
        {notice('dep')}
        {!closed && pendingDep.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="premium-button premium-gradient text-white disabled:opacity-40"
              disabled={run.isPending || !(depTotal > 0)}
              onClick={() => {
                if (!window.confirm(`Kirjataanko poistot ${eur(depTotal)} päivälle ${fy ? new Date(fy.endDate).toLocaleDateString('fi-FI', { timeZone: 'UTC' }) : ''}?\n\nVienti: D 6900 Poistot / K omaisuustili. Kirjattua poistoa ei voi poistaa; se oikaistaan tarvittaessa korjausviennillä.`)) return;
                act('dep', async () => {
                  const r = await postDepreciation(fyId!, pendingDep.map((d) => ({ assetId: d.asset.id, amount: depAmount(d) })));
                  return `Kirjattiin ${r.created} poistovientiä yhteensä ${eur(depTotal)} (D 6900 Poistot / K omaisuustili) tilikauden viimeiselle päivälle.`;
                });
              }}
            >
              {run.isPending && section === 'dep' ? 'Kirjataan…' : `Kirjaa poistot (${eur(depTotal)})`}
            </button>
            <span className="text-xs text-slate-400">Summaa voi muuttaa ennen kirjausta. Poisto kirjataan tilikauden viimeiselle päivälle.</span>
          </div>
        )}
        {!closed && (
          <details className="text-sm">
            <summary className="cursor-pointer text-primary-400 inline-flex items-center gap-1"><Plus className="w-4 h-4" />Lisää käyttöomaisuutta</summary>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <input className={input} placeholder="Nimi" value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} />
              <input className={input} placeholder="Tili (esim. 1010)" value={assetForm.accountNumber} onChange={(e) => setAssetForm({ ...assetForm, accountNumber: e.target.value })} />
              <input className={input} type="date" value={assetForm.acquisitionDate} onChange={(e) => setAssetForm({ ...assetForm, acquisitionDate: e.target.value })} />
              <input className={input} placeholder="Hankintameno €" value={assetForm.acquisitionCost} onChange={(e) => setAssetForm({ ...assetForm, acquisitionCost: e.target.value })} />
              <input className={input} placeholder="Aiemmin tehdyt poistot €" value={assetForm.priorDepreciation} onChange={(e) => setAssetForm({ ...assetForm, priorDepreciation: e.target.value })} />
              <select className={input} value={assetForm.method} onChange={(e) => setAssetForm({ ...assetForm, method: e.target.value })}>
                <option value="DECLINING">Menojäännöspoisto %</option>
                <option value="STRAIGHT_LINE">Tasapoisto (vuotta)</option>
                <option value="MANUAL">Summa käsin</option>
              </select>
              {assetForm.method === 'DECLINING' && <input className={input} placeholder="Poisto-%" value={assetForm.rate} onChange={(e) => setAssetForm({ ...assetForm, rate: e.target.value })} />}
              {assetForm.method === 'STRAIGHT_LINE' && <input className={input} placeholder="Pitoaika vuosina" value={assetForm.usefulLifeYears} onChange={(e) => setAssetForm({ ...assetForm, usefulLifeYears: e.target.value })} />}
              {assetForm.method === 'MANUAL' && <input className={input} placeholder="Vuosipoisto €" value={assetForm.manualAmount} onChange={(e) => setAssetForm({ ...assetForm, manualAmount: e.target.value })} />}
            </div>
            <button type="button" className={`${button} mt-3`} disabled={run.isPending} onClick={() => act('dep', async () => {
              const num = (s: string) => (s === '' ? undefined : Number(s.replace(/\s/g, '').replace(',', '.')));
              await createAsset({ ...assetForm, companyId, acquisitionCost: num(assetForm.acquisitionCost), priorDepreciation: num(assetForm.priorDepreciation),
                rate: num(assetForm.rate), usefulLifeYears: num(assetForm.usefulLifeYears), manualAmount: num(assetForm.manualAmount) });
              return `Käyttöomaisuus "${assetForm.name}" lisätty.`;
            })}>Tallenna</button>
          </details>
        )}
      </Card>

      <Card title="Jaksotukset">
        {notice('accrual')}
        <p className="text-sm text-slate-400">Kulut ja tuotot kohdistetaan sille tilikaudelle, jota ne koskevat. Ehdotukset perustuvat ostolaskujen suoritusjaksoihin; jaksotukset puretaan automaattisesti seuraavan kauden alkuun tilikautta suljettaessa.</p>
        {(accruals.data?.suggestions || []).map((s: any) => (
          <div key={s.voucherNumber} className="flex flex-wrap items-center justify-between gap-3 text-sm border-b border-white/5 pb-2">
            <span>{s.description} · tili {s.accountNumber}</span>
            <span className="flex items-center gap-3">
              <span className="font-semibold">{eur(s.amount)}</span>
              {!closed && <button type="button" className={button} disabled={run.isPending}
                onClick={() => act('accrual', async () => { await createAccrual(fyId!, s); return `Jaksotus kirjattu: ${s.description}`; })}>Kirjaa</button>}
            </span>
          </div>
        ))}
        {(accruals.data?.entries || []).map((e: any) => (
          <div key={e.id} className="text-sm text-slate-300">✓ {e.voucherNumber}: {e.description} ({eur(e.lines.find((l: any) => Number(l.debit) > 0)?.debit || 0)})</div>
        ))}
        {!closed && (
          <details className="text-sm">
            <summary className="cursor-pointer text-primary-400 inline-flex items-center gap-1"><Plus className="w-4 h-4" />Uusi jaksotus käsin</summary>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
              <select className={input} value={accrualForm.kind} onChange={(e) => setAccrualForm({ ...accrualForm, kind: e.target.value })}>
                <option value="accrued_expense">Siirtovelka: kulu tälle kaudelle, maksetaan myöhemmin</option>
                <option value="prepaid_expense">Siirtosaaminen: maksettu kulu kuuluu seuraavalle kaudelle</option>
                <option value="accrued_income">Siirtosaaminen: tuotto tälle kaudelle, saadaan myöhemmin</option>
                <option value="deferred_income">Siirtovelka: saatu tuotto kuuluu seuraavalle kaudelle</option>
              </select>
              <select className={input} value={accrualForm.accountNumber} onChange={(e) => setAccrualForm({ ...accrualForm, accountNumber: e.target.value })}>
                <option value="">Kulu- tai tuottotili…</option>
                {(accounts.data || []).filter((a: any) => a.accountNumber >= '3000').map((a: any) => (
                  <option key={a.accountNumber} value={a.accountNumber}>{a.accountNumber} {a.accountName}</option>
                ))}
              </select>
              <input className={input} placeholder="Summa €" value={accrualForm.amount} onChange={(e) => setAccrualForm({ ...accrualForm, amount: e.target.value })} />
              <input className={input} placeholder="Selite" value={accrualForm.description} onChange={(e) => setAccrualForm({ ...accrualForm, description: e.target.value })} />
            </div>
            <button type="button" className={`${button} mt-3`} disabled={run.isPending} onClick={() => act('accrual', async () => {
              await createAccrual(fyId!, { ...accrualForm, amount: Number(accrualForm.amount.replace(',', '.')) });
              setAccrualForm({ kind: 'accrued_expense', accountNumber: '', amount: '', description: '' });
              return 'Jaksotus kirjattu.';
            })}>Kirjaa jaksotus</button>
          </details>
        )}
      </Card>
    </div>
  );
};

export default ClosingPage;
