import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, Upload } from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import { getMigrations, importMigration, importOpenPayables, previewMigration, previewOpenPayables, undoMigration } from '../api/accounting';
import type { MigrationPreview, OpenPayablesPreview, SignMode } from '../api/accounting';
import { ErrorBox, InfoBox, eur, fmtDate, inputClass, smallButton } from '../components/fees/common';

const errText = (err: any) => err?.response?.data?.error || err?.message || 'Toiminto epäonnistui';

/** Tiedosto tekstiksi (vanhojen järjestelmien vienti on usein Windows-1252-merkistöä). */
const readFile = async (file: File) => {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
};

const HOW: Record<string, { text: string; cls: string }> = {
  saved: { text: 'Aiempi valinta', cls: 'text-emerald-300' },
  number: { text: 'Sama numero', cls: 'text-slate-400' },
  name: { text: 'Nimen perusteella', cls: 'text-primary-300' },
};

const EXAMPLE = 'Tili;Nimi;Saldo\n1100;Rakennukset;500 000,00\n1910;Pankkitili;20 000,00\n2000;Osakepääoma;-100 000,00\n3000;Hoitovastikkeet;-60 000,00';

const classOf = (acc: string) => (acc[0] === '1' ? '1' : acc[0] === '2' ? '2' : acc[0] === '3' ? '3' : '4');
const targetClass = (acc: string) => (acc < '2000' ? '1' : acc < '3000' ? '2' : acc < '4000' ? '3' : '4');

const MigrationPage = () => {
  const { selectedCompany, canManage, canWrite } = useCompany();
  const companyId = selectedCompany?.id as string | undefined;
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [signMode, setSignMode] = useState<SignMode>('DEBIT_POSITIVE');
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [period, setPeriod] = useState({ startDate: '', endDate: '' });
  const [createOpening, setCreateOpening] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const migrations = useQuery({ queryKey: ['migrations', companyId], queryFn: () => getMigrations(companyId!), enabled: !!companyId });

  const runPreview = useMutation({
    mutationFn: () => previewMigration(companyId!, text, signMode),
    onSuccess: (p) => {
      setPreview(p);
      setMapping(Object.fromEntries(p.rows.map((r) => [r.sourceAccount, r.targetAccount ?? ''])));
      if (p.suggestedPeriod) setPeriod(p.suggestedPeriod);
      setError(null);
      setDone(null);
    },
    onError: (err) => setError(errText(err)),
  });

  const runImport = useMutation({
    mutationFn: () => importMigration({ companyId: companyId!, text, signMode, mapping, ...period, createOpening }),
    onSuccess: (r) => {
      setDone(`Siirto tehty: ${r.lines} tiliä vertailukaudelle, tulos ${eur(r.result)}${r.openingEntryId ? ', avaustase kirjattu seuraavalle tilikaudelle' : ''}. Mäppäykset tallennettiin seuraavaa kertaa varten.`);
      setPreview(null);
      setText('');
      setError(null);
      ['migrations', 'fiscalYears', 'closing', 'closingPackage', 'income-statement', 'balance-sheet'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
    },
    onError: (err) => setError(errText(err)),
  });

  const undo = useMutation({
    mutationFn: (fyId: string) => undoMigration(fyId),
    onSuccess: () => { setDone('Siirto peruttu.'); ['migrations', 'fiscalYears', 'closing'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] })); },
    onError: (err) => setError(errText(err)),
  });

  const mappedSum = useMemo(() => {
    if (!preview) return null;
    const unmapped = preview.rows.filter((r) => !mapping[r.sourceAccount]).length;
    return { unmapped };
  }, [preview, mapping]);

  const ready = !!preview && preview.errors.length === 0 && mappedSum?.unmapped === 0 && preview.totals.difference === 0 && period.startDate && period.endDate;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Siirto vanhasta järjestelmästä</h2>
        <p className="text-slate-400 mt-1">Edellisen tilikauden saldot vertailuluvuiksi ja avaustaseeksi, vanhat tilit yhtiön tilikarttaan.</p>
      </div>

      {(migrations.data?.migrated ?? []).length > 0 && (
        <div className="glass-card p-5 space-y-2">
          <h3 className="font-semibold">Tehdyt siirrot</h3>
          {migrations.data!.migrated.map((m) => (
            <div key={m.fiscalYearId} className="flex flex-wrap items-center gap-3 text-sm">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span>Vertailukausi {fmtDate(m.startDate)}–{fmtDate(m.endDate)} · {m.accounts} tiliä · tosite {m.voucherNumber}</span>
              {canManage && (
                <button type="button" className="text-xs text-slate-400 hover:text-rose-300" disabled={undo.isPending}
                  onClick={() => { if (window.confirm('Perutaanko siirto? Vertailukausi ja siirrossa kirjattu avaustase poistetaan.')) undo.mutate(m.fiscalYearId); }}>
                  Peru siirto
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="glass-card p-5 space-y-4">
        <h3 className="font-semibold">1. Saldoluettelo</h3>
        <InfoBox>
          Ota vanhasta kirjanpito-ohjelmasta viimeisen suljetun tilikauden <b>saldoluettelo</b> (tilit ja saldot tilikauden lopussa,
          ennen tuloksen siirtoa). Sarakkeet: tili;nimi;saldo tai tili;nimi;debet;kredit. Excelistä kopioitu taulukko käy suoraan.
        </InfoBox>
        <div className="flex flex-wrap items-center gap-4">
          <label className={`${smallButton} cursor-pointer inline-flex items-center gap-2`}>
            <Upload className="w-4 h-4" />Lataa tiedosto
            <input type="file" accept=".csv,.txt,.tsv" className="hidden"
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await readFile(f)); e.target.value = ''; }} />
          </label>
          <label className="text-sm text-slate-300 flex items-center gap-2">
            <input type="radio" checked={signMode === 'DEBIT_POSITIVE'} onChange={() => setSignMode('DEBIT_POSITIVE')} />
            Kredit-saldot miinusmerkkisinä (tavallisin)
          </label>
          <label className="text-sm text-slate-300 flex items-center gap-2">
            <input type="radio" checked={signMode === 'NATURAL'} onChange={() => setSignMode('NATURAL')} />
            Tuotot, velat ja oma pääoma positiivisina
          </label>
        </div>
        <textarea className={`${inputClass} w-full h-40 font-mono`} value={text} placeholder={EXAMPLE} aria-label="Saldoluettelo"
          onChange={(e) => setText(e.target.value)} />
        <button type="button" className="premium-button premium-gradient text-white disabled:opacity-50"
          disabled={!text.trim() || runPreview.isPending || !canWrite} onClick={() => runPreview.mutate()}>
          {runPreview.isPending ? 'Luetaan…' : 'Esikatsele ja mäppää tilit'}
        </button>
      </div>

      <ErrorBox text={error} />
      {done && <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm">{done}</div>}

      {preview && (
        <>
          {(preview.errors.length > 0 || preview.warnings.length > 0) && (
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-200 space-y-1">
              {[...preview.errors, ...preview.warnings].map((m) => <div key={m}>• {m}</div>)}
            </div>
          )}
          <div className="glass-card overflow-x-auto">
            <div className="p-5 pb-2 flex flex-wrap items-center gap-x-6 gap-y-2">
              <h3 className="font-semibold">2. Tilien mäppäys</h3>
              <span className="text-sm text-slate-400">{preview.rows.length} tiliä</span>
              {mappedSum!.unmapped > 0
                ? <span className="text-sm text-amber-300 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{mappedSum!.unmapped} valitsematta</span>
                : <span className="text-sm text-emerald-300 flex items-center gap-1"><CheckCircle className="w-4 h-4" />Kaikki tilit mäpätty</span>}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-white/5">
                  <th className="p-3 font-medium">Vanha tili</th>
                  <th className="p-3 font-medium text-right">Saldo</th>
                  <th className="p-3 font-medium">Tili yhtiön tilikartassa</th>
                  <th className="p-3 font-medium">Peruste</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => {
                  const chosen = mapping[r.sourceAccount] ?? '';
                  const how = chosen && chosen === r.targetAccount && r.how ? HOW[r.how] : chosen ? { text: 'Valittu', cls: 'text-slate-300' } : null;
                  const sameClass = preview.accounts.filter((a) => targetClass(a.accountNumber) === classOf(r.sourceAccount));
                  return (
                    <tr key={r.sourceAccount} className="border-b border-white/5">
                      <td className="p-3">{r.sourceAccount} {r.sourceName}</td>
                      <td className="p-3 text-right font-mono">{eur(r.amount)}</td>
                      <td className="p-3">
                        <select className={`${inputClass} w-full max-w-sm ${chosen ? '' : 'border-amber-500/50'}`} value={chosen}
                          aria-label={`Kohdetili ${r.sourceAccount}`}
                          onChange={(e) => setMapping({ ...mapping, [r.sourceAccount]: e.target.value })}>
                          <option value="">Valitse tili…</option>
                          <optgroup label="Sama tililuokka">
                            {sameClass.map((a) => <option key={a.accountNumber} value={a.accountNumber}>{a.accountNumber} {a.accountName}</option>)}
                          </optgroup>
                          <optgroup label="Muut tilit">
                            {preview.accounts.filter((a) => !sameClass.includes(a)).map((a) => <option key={a.accountNumber} value={a.accountNumber}>{a.accountNumber} {a.accountName}</option>)}
                          </optgroup>
                        </select>
                      </td>
                      <td className={`p-3 text-xs ${how?.cls ?? 'text-amber-300'}`}>{how?.text ?? 'Valitse'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="p-5 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>Debet {eur(preview.totals.debit)}</span>
              <span>Kredit {eur(preview.totals.credit)}</span>
              <span className={preview.totals.difference ? 'text-rose-300 font-semibold' : 'text-emerald-300'}>
                {preview.totals.difference ? `Ero ${eur(preview.totals.difference)}: luettelo ei täsmää` : 'Täsmää'}
              </span>
              <span>Tilikauden tulos {eur(preview.totals.result)}</span>
            </div>
          </div>

          <div className="glass-card p-5 space-y-4">
            <h3 className="font-semibold">3. Vertailukausi ja avaustase</h3>
            <div className="flex flex-wrap gap-4">
              <label className="text-sm text-slate-400 space-y-1"><div>Alkaa</div>
                <input type="date" className={inputClass} value={period.startDate} onChange={(e) => setPeriod({ ...period, startDate: e.target.value })} />
              </label>
              <label className="text-sm text-slate-400 space-y-1"><div>Päättyy</div>
                <input type="date" className={inputClass} value={period.endDate} onChange={(e) => setPeriod({ ...period, endDate: e.target.value })} />
              </label>
            </div>
            <label className="text-sm text-slate-300 flex items-center gap-2">
              <input type="checkbox" checked={createOpening} onChange={(e) => setCreateOpening(e.target.checked)} />
              Kirjaa samalla seuraavan tilikauden avaustase (tulos siirtyy edellisten tilikausien voittoon)
            </label>
            <p className="text-xs text-slate-500">
              Vertailukausi tallentuu suljettuna tilikautena, joten tuloslaskelmaan, taseeseen ja vastikelaskelmaan tulevat
              edellisen vuoden luvut. Siirron voi perua niin kauan kuin seuraava tilikausi on avoinna.
            </p>
            {canManage ? (
              <button type="button" className="premium-button premium-gradient text-white disabled:opacity-50" disabled={!ready || runImport.isPending}
                onClick={() => runImport.mutate()}>
                {runImport.isPending ? 'Siirretään…' : 'Tee siirto'}
              </button>
            ) : (
              <p className="text-sm text-slate-400">Siirron tekee isännöitsijä.</p>
            )}
          </div>
        </>
      )}

      {(migrations.data?.migrated ?? []).length > 0 && <OpenPayablesCard companyId={companyId!} canWrite={canWrite} canManage={canManage} />}
    </div>
  );
};

const PAYABLES_EXAMPLE = 'Toimittaja;Laskunumero;Summa;Eräpäivä;Viite;IBAN\nKiinteistöhuolto Oy;2024-1288;4 120,00;15.1.2025;12345 67890;FI21 1234 5600 0007 85';

/**
 * Avaustaseen ostovelat laskuittain: kun ne maksetaan, pankkitäsmäytys löytää laskun eikä ehdota kulutiliä.
 * Summan on täsmättävä avaustaseen ostovelkoihin.
 */
const OpenPayablesCard = ({ companyId, canWrite, canManage }: { companyId: string; canWrite: boolean; canManage: boolean }) => {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<OpenPayablesPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: () => previewOpenPayables(companyId, text),
    onSuccess: (p) => { setPreview(p); setError(null); setDone(null); },
    onError: (err) => setError(errText(err)),
  });
  const save = useMutation({
    mutationFn: () => importOpenPayables(companyId, text),
    onSuccess: (r) => {
      setDone(`Tuotiin ${r.created} avointa ostolaskua (${eur(r.total)}). Ne näkyvät Ostolaskut-sivulla, ja maksut täsmäytyvät tiliotteelta automaattisesti.`);
      setPreview(null); setText(''); setError(null);
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
    },
    onError: (err) => setError(errText(err)),
  });
  return (
    <div className="glass-card p-5 space-y-4">
      <h3 className="font-semibold">4. Avoimet ostolaskut (valinnainen)</h3>
      <InfoBox>
        Avaustaseen <b>ostovelat laskuittain</b> vanhan järjestelmän reskontrasta. Kun lasku maksetaan, maksu kohdistuu siihen
        automaattisesti (ei kuluksi). Sarakkeet otsikoiden mukaan: Toimittaja, Laskunumero, Summa, Eräpäivä, Viite, IBAN.
        Laskujen summan on oltava sama kuin avaustaseen ostovelat.
      </InfoBox>
      <div className="flex flex-wrap items-center gap-4">
        <label className={`${smallButton} cursor-pointer inline-flex items-center gap-2`}>
          <Upload className="w-4 h-4" />Lataa tiedosto
          <input type="file" accept=".csv,.txt,.tsv" className="hidden"
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await readFile(f)); e.target.value = ''; }} />
        </label>
      </div>
      <textarea className={`${inputClass} w-full h-32 font-mono`} value={text} placeholder={PAYABLES_EXAMPLE} aria-label="Avoimet ostolaskut"
        onChange={(e) => { setText(e.target.value); setPreview(null); }} />
      <div className="flex flex-wrap gap-3">
        <button type="button" className={smallButton} disabled={!text.trim() || check.isPending || !canWrite} onClick={() => check.mutate()}>
          {check.isPending ? 'Tarkistetaan…' : 'Tarkista'}
        </button>
        {canManage && preview && preview.errors.length === 0 && (
          <button type="button" className="premium-button premium-gradient text-white disabled:opacity-50" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Tuodaan…' : `Tuo ${preview.items.length} laskua`}
          </button>
        )}
      </div>
      <ErrorBox text={error} />
      {done && <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm">{done}</div>}
      {preview && (
        <div className="space-y-2 text-sm">
          {[...preview.errors, ...preview.warnings].map((m) => <div key={m} className="text-amber-200">• {m}</div>)}
          <div className={preview.total === preview.openingPayables ? 'text-emerald-300' : 'text-rose-300'}>
            Laskut yhteensä {eur(preview.total)} · avaustaseen ostovelat {eur(preview.openingPayables)}
          </div>
          <table className="w-full">
            <tbody>
              {preview.items.map((i) => (
                <tr key={i.line} className="border-b border-white/5">
                  <td className="p-2">{i.supplierName}</td><td className="p-2">{i.invoiceNumber ?? '–'}</td>
                  <td className="p-2 text-right font-mono">{eur(i.amount)}</td><td className="p-2">{i.dueDate ? fmtDate(i.dueDate) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default MigrationPage;
