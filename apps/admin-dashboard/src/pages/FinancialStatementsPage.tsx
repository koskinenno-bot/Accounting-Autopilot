import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, CheckCircle, FileDown, Lock, Plus, RotateCcw, Trash2, Unlock } from 'lucide-react';
import { archiveClosing } from '../api/documents';
import { useCompany } from '../hooks/useCompany';
import FiscalYearSelect, { fiscalYearLabel } from '../components/FiscalYearSelect';
import { getClosingPackage, openBookPdf } from '../api/reports';
import type { BalanceDetail, BookPdf, ClosingPackageView, PackageSection } from '../api/reports';
import { getTaxReturn, updateClosingPackage } from '../api/accounting';
import type { ClosingPackageUpdate } from '../api/accounting';
import { ErrorBox, InfoBox, eur, inputClass, smallButton } from '../components/fees/common';

type Tab = 'report' | 'notes' | 'balance' | 'sign' | 'print' | 'tax';
const TABS: { key: Tab; label: string }[] = [
  { key: 'report', label: 'Toimintakertomus' },
  { key: 'notes', label: 'Liitetiedot' },
  { key: 'balance', label: 'Tase-erittelyt' },
  { key: 'sign', label: 'Allekirjoitus' },
  { key: 'print', label: 'Tulosteet' },
  { key: 'tax', label: 'Veroilmoitus' },
];

// reporting-service palauttaa virheen kentässä detail, accounting-service kentässä error
const errText = (err: any) => err?.response?.data?.error || err?.response?.data?.detail || err?.message || 'Toiminto epäonnistui';
const isoDate = (d: string | null) => (d ? d.slice(0, 10) : '');

const SaveBar = ({ onSave, pending, message, disabled }: { onSave: () => void; pending: boolean; message: string | null; disabled?: boolean }) => (
  <div className="flex items-center gap-3">
    <button type="button" className="premium-button premium-gradient text-white disabled:opacity-50" onClick={onSave} disabled={pending || disabled}>
      {pending ? 'Tallennetaan…' : 'Tallenna'}
    </button>
    {message && <span className="text-sm text-emerald-300">{message}</span>}
  </div>
);

/** Toimintakertomuksen tai liitetietojen osiot. Automaattiseen tekstiin palattaessa tallennetaan tyhjä (= pohja). */
const SectionsEditor = ({ sections, readOnly, onSave }: {
  sections: PackageSection[]; readOnly: boolean; onSave: (map: Record<string, string>) => Promise<unknown>;
}) => {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(Object.fromEntries(sections.map((s) => [s.key, s.text]))); }, [sections]);
  const save = useMutation({
    mutationFn: () => onSave(Object.fromEntries(sections.map((s) => {
      const text = (draft[s.key] ?? '').trim();
      return [s.key, text === s.auto.trim() ? '' : text];
    }))),
    onSuccess: () => { setMessage('Tallennettu'); setError(null); setTimeout(() => setMessage(null), 3000); },
    onError: (err) => setError(errText(err)),
  });
  const placeholders = (t: string) => /\[[^\]]+\]/.test(t);
  return (
    <div className="space-y-4">
      <InfoBox>
        Teksti on tehty pohjaksi kirjanpidon luvuista. Hakasulkeissa olevat <span className="text-amber-300">[kohdat]</span> pitää
        täydentää ennen tulostusta. Lukuja sisältävät osiot päivittyvät automaattisesti, kunnes muokkaat niitä.
      </InfoBox>
      {sections.map((s) => {
        const text = draft[s.key] ?? '';
        const isAuto = text.trim() === s.auto.trim();
        return (
          <div key={s.key} className="glass-card p-5 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{s.title}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${isAuto ? 'border-white/10 text-slate-400' : 'border-primary-500/30 text-primary-300'}`}>
                {isAuto ? 'Automaattinen' : 'Muokattu'}
              </span>
              {placeholders(text) && <span className="text-xs px-2 py-0.5 rounded-full border border-amber-500/30 text-amber-300">Täydennettävää</span>}
              {!readOnly && !isAuto && (
                <button type="button" className="ml-auto text-xs text-slate-400 hover:text-white flex items-center gap-1"
                  onClick={() => setDraft({ ...draft, [s.key]: s.auto })}>
                  <RotateCcw className="w-3.5 h-3.5" />Palauta automaattinen teksti
                </button>
              )}
            </div>
            <textarea className={`${inputClass} w-full min-h-28 leading-relaxed`} value={text} readOnly={readOnly}
              rows={Math.min(14, Math.max(3, Math.ceil(text.length / 110) + text.split('\n').length))}
              onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} aria-label={s.title} />
          </div>
        );
      })}
      <ErrorBox text={error} />
      {!readOnly && <SaveBar onSave={() => save.mutate()} pending={save.isPending} message={message} />}
    </div>
  );
};

const BalanceTab = ({ rows, hasPrevious, readOnly, onSave }: {
  rows: BalanceDetail[]; hasPrevious: boolean; readOnly: boolean; onSave: (notes: Record<string, string>) => Promise<unknown>;
}) => {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setNotes(Object.fromEntries(rows.map((r) => [r.account, r.note]))); }, [rows]);
  const save = useMutation({
    mutationFn: () => onSave(notes),
    onSuccess: () => { setMessage('Tallennettu'); setError(null); setTimeout(() => setMessage(null), 3000); },
    onError: (err) => setError(errText(err)),
  });
  const groups = [...new Set(rows.map((r) => r.group))];
  if (!rows.length) return <div className="glass-card p-8 text-center text-slate-400">Tilikaudella ei ole taseen tilien kirjauksia.</div>;
  return (
    <div className="space-y-4">
      <InfoBox>
        Tase-erittely näyttää jokaisen taseen tilin saldon ja sen, mistä saldo koostuu. Kirjoita erittely, esim. pankkitilin
        tiliotteen saldo, lainan lainanantaja ja lainanumero tai avoimet saamiset. Tase-erittelyt eivät ole julkisia.
      </InfoBox>
      {groups.map((g) => (
        <div key={g} className="glass-card overflow-x-auto">
          <div className="px-4 pt-4 font-semibold">{g}</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-white/5">
                <th className="p-3 font-medium">Tili</th>
                <th className="p-3 font-medium text-right">Avaava</th>
                <th className="p-3 font-medium text-right">Debet</th>
                <th className="p-3 font-medium text-right">Kredit</th>
                <th className="p-3 font-medium text-right">Päättävä</th>
                {hasPrevious && <th className="p-3 font-medium text-right">Edellinen</th>}
                <th className="p-3 font-medium w-1/3">Erittely</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter((r) => r.group === g).map((r) => (
                <tr key={r.account} className="border-b border-white/5 align-top">
                  <td className="p-3">
                    {r.label}
                    {r.openingMismatch && (
                      <div className="text-xs text-amber-300 flex items-center gap-1 mt-1"><AlertTriangle className="w-3.5 h-3.5" />Avaava saldo poikkeaa edellisestä tilikaudesta</div>
                    )}
                  </td>
                  <td className="p-3 text-right font-mono">{eur(r.opening)}</td>
                  <td className="p-3 text-right font-mono text-slate-400">{eur(r.debit)}</td>
                  <td className="p-3 text-right font-mono text-slate-400">{eur(r.credit)}</td>
                  <td className="p-3 text-right font-mono font-semibold">{eur(r.closing)}</td>
                  {hasPrevious && <td className="p-3 text-right font-mono text-slate-400">{eur(r.previous ?? 0)}</td>}
                  <td className="p-3">
                    <textarea className={`${inputClass} w-full`} rows={1} readOnly={readOnly} value={notes[r.account] ?? ''}
                      placeholder={readOnly ? '' : 'Esim. tiliote 31.12. / laina nro …'} aria-label={`Erittely ${r.account}`}
                      onChange={(e) => setNotes({ ...notes, [r.account]: e.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <ErrorBox text={error} />
      {!readOnly && <SaveBar onSave={() => save.mutate()} pending={save.isPending} message={message} />}
    </div>
  );
};

const DEFAULT_SIGNERS = [
  { name: '', role: 'hallituksen puheenjohtaja' },
  { name: '', role: 'hallituksen jäsen' },
  { name: '', role: 'hallituksen jäsen' },
  { name: '', role: 'isännöitsijä' },
];

const SignTab = ({ view, readOnly, canWrite, canManage, onSave }: {
  view: ClosingPackageView; readOnly: boolean; canWrite: boolean; canManage: boolean; onSave: (body: ClosingPackageUpdate) => Promise<unknown>;
}) => {
  const p = view.package;
  const { selectedCompany } = useCompany();
  const [signers, setSigners] = useState(p.signers.length ? p.signers : DEFAULT_SIGNERS);
  const [place, setPlace] = useState(p.signPlace ?? '');
  const [signDate, setSignDate] = useState(isoDate(p.signDate));
  const [auditor, setAuditor] = useState(p.auditorName ?? '');
  const [kind, setKind] = useState<'AUDITOR' | 'INSPECTOR'>(p.auditorKind ?? 'AUDITOR');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const archive = useMutation({
    mutationFn: () => archiveClosing(selectedCompany!.id, view.fiscalYear.id),
    onSuccess: (r) => {
      setError(null);
      setMessage(r.archived.length
        ? `Arkistoitu: ${r.archived.join(', ')}. Säilytys ${new Date(r.retentionUntil).toLocaleDateString('fi-FI')} asti (Dokumentit-sivu).`
        : 'Tilinpäätös on jo arkistoitu (Dokumentit-sivu).');
    },
    onError: (err) => setError(`Tilinpäätös on allekirjoitettu, mutta arkistointi epäonnistui: ${errText(err)}. Yritä uudelleen painikkeella Arkistoi.`),
  });
  const run = useMutation({
    mutationFn: (body: ClosingPackageUpdate) => onSave(body),
    onSuccess: (_d, body) => {
      setError(null);
      setMessage(body.signed === true ? 'Merkitty allekirjoitetuksi. Arkistoidaan…' : body.signed === false ? 'Lukitus avattu' : 'Tallennettu');
      // Palvelin arkistoi allekirjoitetun tilinpäätöksen (KPL 2:10 §); jos se epäonnistui, yritetään täältä uudelleen
      const done = (_d as any)?.archive;
      if (body.signed === true && done && !done.error) setMessage(`Merkitty allekirjoitetuksi ja arkistoitu: ${[...done.archived, ...done.skipped].join(', ')}.`);
      else if (body.signed === true) archive.mutate();
      else setTimeout(() => setMessage(null), 3000);
    },
    onError: (err) => setError(errText(err)),
  });
  const fields = (): ClosingPackageUpdate => ({
    signers: signers.filter((s) => s.name.trim()), signPlace: place || null, signDate: signDate || null,
    auditorName: auditor || null, auditorKind: kind,
  });
  const closed = view.fiscalYear.status === 'CLOSED';
  return (
    <div className="space-y-4">
      <div className="glass-card p-5 space-y-4">
        <h3 className="font-semibold">Allekirjoittajat</h3>
        <p className="text-sm text-slate-400">Tilinpäätöksen ja toimintakertomuksen allekirjoittavat hallituksen jäsenet ja isännöitsijä. Nimet tulostuvat allekirjoitussivulle.</p>
        {signers.map((s, i) => (
          <div key={i} className="flex flex-wrap gap-2 items-center">
            <input className={`${inputClass} w-64`} placeholder="Nimi" value={s.name} readOnly={readOnly} aria-label={`Allekirjoittaja ${i + 1}`}
              onChange={(e) => setSigners(signers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input className={`${inputClass} w-56`} placeholder="Rooli" value={s.role} readOnly={readOnly} aria-label={`Rooli ${i + 1}`}
              onChange={(e) => setSigners(signers.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
            {!readOnly && (
              <button type="button" className="text-slate-500 hover:text-rose-300" aria-label="Poista" onClick={() => setSigners(signers.filter((_x, j) => j !== i))}>
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
        {!readOnly && signers.length < 12 && (
          <button type="button" className="text-sm text-primary-400 flex items-center gap-1" onClick={() => setSigners([...signers, { name: '', role: 'hallituksen jäsen' }])}>
            <Plus className="w-4 h-4" />Lisää allekirjoittaja
          </button>
        )}
        <div className="flex flex-wrap gap-4">
          <label className="text-sm text-slate-400 space-y-1"><div>Paikka</div>
            <input className={`${inputClass} w-48`} value={place} readOnly={readOnly} onChange={(e) => setPlace(e.target.value)} placeholder="Esim. Helsinki" />
          </label>
          <label className="text-sm text-slate-400 space-y-1"><div>Päivämäärä (jätä tyhjäksi, jos kirjoitetaan käsin)</div>
            <input className={inputClass} type="date" value={signDate} readOnly={readOnly} onChange={(e) => setSignDate(e.target.value)} />
          </label>
        </div>
      </div>
      <div className="glass-card p-5 space-y-3">
        <h3 className="font-semibold">Tarkastus</h3>
        <div className="flex flex-wrap gap-4">
          <label className="text-sm text-slate-400 space-y-1"><div>Tarkastaja</div>
            <select className={inputClass} value={kind} disabled={readOnly} onChange={(e) => setKind(e.target.value as 'AUDITOR' | 'INSPECTOR')}>
              <option value="AUDITOR">Tilintarkastaja (HT/KHT)</option>
              <option value="INSPECTOR">Toiminnantarkastaja</option>
            </select>
          </label>
          <label className="text-sm text-slate-400 space-y-1"><div>Nimi</div>
            <input className={`${inputClass} w-64`} value={auditor} readOnly={readOnly} onChange={(e) => setAuditor(e.target.value)} />
          </label>
        </div>
        <p className="text-xs text-slate-500">Tarkista yhtiön tilintarkastusvelvollisuus (asunto-osakeyhtiölaki ja tilintarkastuslaki). Jos tilintarkastajaa ei valita, yhtiöllä on toiminnantarkastaja.</p>
      </div>
      <ErrorBox text={error} />
      <div className="flex flex-wrap items-center gap-3">
        {!readOnly && (
          <button type="button" className={smallButton} disabled={run.isPending} onClick={() => run.mutate(fields())}>Tallenna</button>
        )}
        {!p.signedAt && canWrite && (
          <button type="button" className="premium-button premium-gradient text-white flex items-center gap-2 disabled:opacity-50"
            disabled={run.isPending || !closed} title={closed ? '' : 'Sulje tilikausi ensin'}
            onClick={() => {
              if (!window.confirm('Merkitäänkö tilinpäätös allekirjoitetuksi? Tekstit lukitaan.')) return;
              run.mutate({ ...fields(), signed: true });
            }}>
            <Lock className="w-4 h-4" />Merkitse allekirjoitetuksi
          </button>
        )}
        {p.signedAt && canWrite && (
          <button type="button" className={`${smallButton} flex items-center gap-1`} disabled={archive.isPending} onClick={() => archive.mutate()}
            title="Tallentaa tilinpäätöksen, tase-erittelyt, päiväkirjan ja pääkirjan PDF:t lukittuina arkistoon 10 vuodeksi">
            <Archive className="w-4 h-4" />{archive.isPending ? 'Arkistoidaan…' : 'Arkistoi'}
          </button>
        )}
        {p.signedAt && canManage && (
          <button type="button" className={`${smallButton} flex items-center gap-1`} disabled={run.isPending} onClick={() => run.mutate({ signed: false })}>
            <Unlock className="w-4 h-4" />Avaa lukitus
          </button>
        )}
        {!closed && <span className="text-sm text-slate-400">Tilinpäätöksen voi merkitä allekirjoitetuksi, kun tilikausi on suljettu.</span>}
        {message && <span className="text-sm text-emerald-300">{message}</span>}
      </div>
    </div>
  );
};

const PRINTS: { kind: BookPdf; title: string; text: string }[] = [
  { kind: 'closing-package', title: 'Tilinpäätös', text: 'Kansilehti, toimintakertomus, tuloslaskelma, tase, vastikelaskelma, liitetiedot ja allekirjoitussivu.' },
  { kind: 'balance-details', title: 'Tase-erittelyt', text: 'Taseen tilit saldoineen ja erittelyineen. Ei julkinen, säilytetään 10 vuotta.' },
  { kind: 'journal', title: 'Päiväkirja', text: 'Kaikki tilikauden viennit aikajärjestyksessä.' },
  { kind: 'general-ledger', title: 'Pääkirja', text: 'Viennit tileittäin juoksevine saldoineen.' },
];

const PrintTab = ({ companyId, fyId, missing }: { companyId: string; fyId: string; missing: string[] }) => {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {missing.length > 0 && (
        <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-200 space-y-1">
          <div className="font-semibold">Ennen lopullista tulostusta:</div>
          {missing.map((m) => <div key={m}>• {m}</div>)}
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        {PRINTS.map((p) => (
          <div key={p.kind} className="glass-card p-5 flex flex-col gap-3">
            <div className="font-semibold">{p.title}</div>
            <div className="text-sm text-slate-400 flex-1">{p.text}</div>
            <button type="button" className={`${smallButton} self-start flex items-center gap-1`}
              onClick={() => { setError(null); openBookPdf(companyId, p.kind, fyId).catch((err) => setError(`${p.title}: ${errText(err)}`)); }}>
              <FileDown className="w-4 h-4" />Avaa PDF
            </button>
          </div>
        ))}
      </div>
      <ErrorBox text={error} />
    </div>
  );
};

const TaxTab = ({ fyId }: { fyId: string }) => {
  const { data, isLoading, error } = useQuery({ queryKey: ['taxReturn', fyId], queryFn: () => getTaxReturn(fyId) });
  if (isLoading) return <div className="glass-card h-48 animate-pulse" />;
  if (error || !data) return <ErrorBox text={`Veroilmoitusta ei saatu laskettua: ${errText(error)}`} />;
  const t = data.totals;
  const section = (kind: 'income' | 'expense', title: string, booksTotal: number, taxTotal: number) => (
    <>
      <tr><td colSpan={3} className="pt-4 pb-1 text-xs uppercase tracking-wide text-slate-500">{title}</td></tr>
      {data.rows.filter((r) => r.kind === kind).map((r) => (
        <tr key={r.key} className="border-t border-white/5 align-top">
          <td className="py-2 pr-4">
            <div>{r.label}</div>
            {r.accounts.length > 0 && <div className="text-xs text-slate-500">Tilit {r.accounts.join(', ')}</div>}
            {r.note && <div className="text-xs text-amber-300/80">{r.note}</div>}
          </td>
          <td className="py-2 text-right font-mono">{eur(r.books)}</td>
          <td className="py-2 text-right font-mono">{eur(r.tax)}</td>
        </tr>
      ))}
      <tr className="border-t border-white/10 font-semibold">
        <td className="py-2">Yhteensä</td>
        <td className="py-2 text-right font-mono">{eur(booksTotal)}</td>
        <td className="py-2 text-right font-mono">{eur(taxTotal)}</td>
      </tr>
    </>
  );
  return (
    <div className="space-y-4">
      <InfoBox>{`Asunto- ja kiinteistöyhteisön veroilmoitus (lomake 4). Luvut täytetään OmaVerossa Kirjanpito- ja Verotus-sarakkeisiin. Viimeinen jättöpäivä on yleensä neljän kuukauden kuluttua tilikauden päättymisestä (n. ${new Date(data.dueHint).toLocaleDateString('fi-FI')}); tarkista oma eräpäivä OmaVerosta.`}</InfoBox>
      {data.warnings.length > 0 && (
        <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-200 space-y-1">
          {data.warnings.map((w) => <div key={w} className="flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{w}</div>)}
        </div>
      )}
      <div className="glass-card p-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-400 text-left">
              <th className="pb-2 font-medium">Rivi</th>
              <th className="pb-2 font-medium text-right w-36">Kirjanpito</th>
              <th className="pb-2 font-medium text-right w-36">Verotus</th>
            </tr>
          </thead>
          <tbody>
            {section('income', 'Tuotot', t.booksIncome, t.taxIncome)}
            {section('expense', 'Kulut', t.booksExpense, t.taxExpense)}
            <tr className="border-t-2 border-white/20 font-semibold">
              <td className="py-3">Tulos</td>
              <td className="py-3 text-right font-mono">{eur(t.booksResult)}</td>
              <td className="py-3 text-right font-mono">{eur(t.taxIncome - t.taxExpense)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <div className="text-sm text-slate-400">Verotettava tulo</div>
          <div className={`text-2xl font-mono font-semibold mt-1 ${t.taxableIncome ? 'text-amber-300' : ''}`}>{eur(t.taxableIncome)}</div>
          {t.taxableIncome > 0 && <div className="text-xs text-slate-400 mt-1">Yhteisövero maksetaan tästä. Aiempien vuosien vahvistetut tappiot vähennetään verotuksessa.</div>}
        </div>
        <div className="glass-card p-5">
          <div className="text-sm text-slate-400">Vahvistettava tappio</div>
          <div className="text-2xl font-mono font-semibold mt-1">{eur(t.confirmedLoss)}</div>
          {t.confirmedLoss > 0 && <div className="text-xs text-slate-400 mt-1">Tappio vähennetään seuraavien 10 vuoden tuloista.</div>}
        </div>
      </div>
    </div>
  );
};

const FinancialStatementsPage = () => {
  const { selectedCompany, canWrite, canManage } = useCompany();
  const companyId = selectedCompany?.id as string | undefined;
  const queryClient = useQueryClient();
  const [fyId, setFyId] = useState<string>();
  const [tab, setTab] = useState<Tab>('report');
  const { data, isLoading, error } = useQuery({
    queryKey: ['closingPackage', companyId, fyId],
    queryFn: () => getClosingPackage(companyId!, fyId),
    enabled: !!companyId && !!fyId,
  });
  const save = async (body: ClosingPackageUpdate) => {
    const result = await updateClosingPackage(fyId!, body);
    await queryClient.invalidateQueries({ queryKey: ['closingPackage', companyId, fyId] });
    return result;
  };
  const readOnly = !canWrite || !!data?.package.signedAt;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Tilinpäätöspaketti</h2>
          <p className="text-slate-400 mt-1">Toimintakertomus, liitetiedot, tase-erittelyt, allekirjoitukset ja tulosteet.</p>
        </div>
        <FiscalYearSelect companyId={companyId} value={fyId} onChange={setFyId} />
      </div>

      {isLoading && <div className="glass-card h-64 animate-pulse" />}
      {error && <ErrorBox text={`Tilinpäätöspakettia ei saatu haettua: ${errText(error)}`} />}
      {data && (
        <>
          <div className="glass-card p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span>Tilikausi {fiscalYearLabel(data.fiscalYear)}</span>
            <span>Tulos <span className="font-mono font-semibold">{eur(data.netProfit)}</span></span>
            {data.package.signedAt
              ? <span className="text-emerald-300 flex items-center gap-1"><CheckCircle className="w-4 h-4" />Allekirjoitettu, tekstit lukittu</span>
              : data.missing.length
                ? <span className="text-amber-300 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{data.missing.length} täydennettävää kohtaa</span>
                : <span className="text-emerald-300 flex items-center gap-1"><CheckCircle className="w-4 h-4" />Valmis allekirjoitettavaksi</span>}
          </div>

          <div className="flex flex-wrap gap-1 p-1 bg-slate-900/50 border border-white/5 rounded-xl w-fit">
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab === t.key ? 'bg-primary-500 text-white' : 'text-slate-400 hover:text-white'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'report' && <SectionsEditor sections={data.report} readOnly={readOnly} onSave={(report) => save({ report })} />}
          {tab === 'notes' && <SectionsEditor sections={data.notes} readOnly={readOnly} onSave={(notes) => save({ notes })} />}
          {tab === 'balance' && (
            <BalanceTab rows={data.balanceDetails} hasPrevious={!!data.previousFiscalYear} readOnly={readOnly} onSave={(balanceNotes) => save({ balanceNotes })} />
          )}
          {tab === 'sign' && (
            <SignTab key={data.package.updatedAt ?? 'new'} view={data} readOnly={readOnly} canWrite={canWrite} canManage={canManage} onSave={save} />
          )}
          {tab === 'print' && companyId && fyId && <PrintTab companyId={companyId} fyId={fyId} missing={data.missing} />}
          {tab === 'tax' && fyId && <TaxTab fyId={fyId} />}
        </>
      )}
    </div>
  );
};

export default FinancialStatementsPage;
