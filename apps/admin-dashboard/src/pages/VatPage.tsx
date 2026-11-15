import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, Download } from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import { downloadVatFile, getVatPeriods, getVatReturn, getVatSettings, saveVatSettings, settleVat } from '../api/accounting';
import type { VatSettings } from '../api/accounting';
import { ErrorBox, InfoBox, eur, fmtDate, inputClass, smallButton } from '../components/fees/common';

const errText = async (err: any) => {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try { return JSON.parse(await data.text()).error || 'Toiminto epäonnistui'; } catch { return 'Toiminto epäonnistui'; }
  }
  return data?.error || err?.message || 'Toiminto epäonnistui';
};
const PERIOD_LABEL: Record<string, string> = { MONTH: 'Kuukausi', QUARTER: 'Neljännesvuosi', YEAR: 'Kalenterivuosi' };
// Kausiveroilmoituksen järjestys: myynnin verot, ostojen verot, vähennys, maksettava; muut kentät perään
const MAIN = ['301', '302', '303', '304', '305', '306', '318', '307', '308'];

/** Arvonlisävero: asetukset, verokaudet, kausiveroilmoituksen luvut ja ALV-tilitys. */
const VatPage = () => {
  const { selectedCompany, canManage } = useCompany();
  const companyId = selectedCompany?.id;
  const queryClient = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<(Omit<VatSettings, 'deductionPercent'> & { deductionPercent: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const settingsQ = useQuery({ queryKey: ['vatSettings', companyId], queryFn: () => getVatSettings(companyId!), enabled: !!companyId });
  const settings = settingsQ.data?.settings;
  useEffect(() => {
    if (settings) {
      setDraft({
        ...settings, deductionPercent: String(settings.deductionPercent).replace('.', ','),
        businessId: settings.businessId || selectedCompany?.businessId || '',
        registeredFrom: settings.registeredFrom ? settings.registeredFrom.slice(0, 10) : '',
      });
    }
  }, [settings, selectedCompany?.businessId]);

  const periodsQ = useQuery({
    queryKey: ['vatPeriods', companyId, year], queryFn: () => getVatPeriods(companyId!, year), enabled: !!companyId && !!settings?.registered,
  });
  const returnQ = useQuery({ queryKey: ['vatReturn', companyId, open], queryFn: () => getVatReturn(companyId!, open!), enabled: !!companyId && !!open });

  const flash = (t: string) => { setMessage(t); setTimeout(() => setMessage(null), 5000); };
  const save = useMutation({
    mutationFn: () => saveVatSettings({
      companyId: companyId!, registered: draft!.registered, period: draft!.period, deductionPercent: Number(draft!.deductionPercent.replace(',', '.')),
      registeredFrom: draft!.registeredFrom || null, businessId: draft!.businessId || null, contactPhone: draft!.contactPhone || null,
    }),
    onSuccess: () => { setError(null); flash('ALV-asetukset tallennettu'); queryClient.invalidateQueries({ queryKey: ['vatSettings', companyId] }); queryClient.invalidateQueries({ queryKey: ['vatPeriods'] }); },
    onError: async (err) => setError(await errText(err)),
  });
  const settle = useMutation({
    mutationFn: (period: string) => settleVat(companyId!, period),
    onSuccess: (r) => {
      setError(null);
      flash(r.payable >= 0 ? `ALV-tilitys kirjattu. Maksettava ${eur(r.payable)}.` : `ALV-tilitys kirjattu. Palautettava ${eur(-r.payable)}.`);
      queryClient.invalidateQueries({ queryKey: ['vatPeriods'] }); queryClient.invalidateQueries({ queryKey: ['vatReturn'] });
    },
    onError: async (err) => setError(await errText(err)),
  });
  const download = useMutation({ mutationFn: (period: string) => downloadVatFile(companyId!, period), onError: async (err) => setError(await errText(err)) });

  if (!selectedCompany) return null;
  const set = (patch: Partial<NonNullable<typeof draft>>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const r = returnQ.data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Arvonlisävero</h2>
        <p className="text-slate-400 mt-1">
          Taloyhtiö on yleensä arvonlisäveroton. Jos yhtiö on hakeutunut verovelvolliseksi (esim. liiketilojen vuokraus),
          ostojen vähennettävä vero ja myynnin vero kirjautuvat automaattisesti ja kausiveroilmoituksen luvut lasketaan tässä.
        </p>
      </div>

      {draft && (
        <div className="glass-card p-5 space-y-4">
          <div className="font-semibold">Asetukset</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.registered} disabled={!canManage} onChange={(e) => set({ registered: e.target.checked })} />
            Yhtiö on arvonlisäverovelvollinen (merkitty arvonlisäverorekisteriin)
          </label>
          {draft.registered && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <label className="space-y-1"><div className="text-slate-300">Verokausi</div>
                <select className={`${inputClass} w-full`} value={draft.period} disabled={!canManage} onChange={(e) => set({ period: e.target.value as VatSettings['period'] })}>
                  {Object.entries(PERIOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="space-y-1"><div className="text-slate-300">Vähennysoikeus yhteisistä kuluista (%)</div>
                <input className={`${inputClass} w-full text-right`} value={draft.deductionPercent} disabled={!canManage} onChange={(e) => set({ deductionPercent: e.target.value })} />
              </label>
              <label className="space-y-1"><div className="text-slate-300">Verovelvollisuus alkaen</div>
                <input type="date" className={`${inputClass} w-full`} value={draft.registeredFrom ?? ''} disabled={!canManage} onChange={(e) => set({ registeredFrom: e.target.value })} />
              </label>
              <label className="space-y-1"><div className="text-slate-300">Y-tunnus</div>
                <input className={`${inputClass} w-full`} value={draft.businessId ?? ''} disabled={!canManage} onChange={(e) => set({ businessId: e.target.value })} />
              </label>
              <label className="space-y-1"><div className="text-slate-300">Yhteyshenkilön puhelin (ilmoitukselle)</div>
                <input className={`${inputClass} w-full`} value={draft.contactPhone ?? ''} disabled={!canManage} onChange={(e) => set({ contactPhone: e.target.value })} />
              </label>
            </div>
          )}
          {draft.registered && (
            <div className="text-xs text-slate-400">
              Vähennysoikeus: osuus, jolla yhtiön tiloja käytetään verollisesti (esim. verollisesti vuokratut neliöt / kaikki neliöt).
              Ostolaskun verosta tämä osa kirjataan tilille 1750 ja loput jää kuluksi. Verollinen vuokra laskutetaan Vastikkeet-sivulla
              valitsemalla vastikkeelle ALV-prosentti.
            </div>
          )}
          {canManage && (
            <button type="button" className="premium-button premium-gradient text-white disabled:opacity-50" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Tallennetaan…' : 'Tallenna asetukset'}
            </button>
          )}
        </div>
      )}

      {settings?.registered && (
        <div className="glass-card p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="font-semibold">Verokaudet</div>
            <select className={`${inputClass} ml-auto`} value={year} onChange={(e) => { setYear(Number(e.target.value)); setOpen(null); }} aria-label="Vuosi">
              {[0, 1, 2, 3].map((i) => new Date().getFullYear() - i).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-white/5">
                  <th className="p-2 font-medium">Kausi</th>
                  <th className="p-2 font-medium">Eräpäivä</th>
                  <th className="p-2 font-medium text-right">Vero myynneistä</th>
                  <th className="p-2 font-medium text-right">Vähennettävä</th>
                  <th className="p-2 font-medium text-right">Maksettava</th>
                  <th className="p-2 font-medium">Tila</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {(periodsQ.data?.periods ?? []).map((p) => (
                  <tr key={p.key} className={`border-b border-white/5 ${open === p.key ? 'bg-white/5' : ''}`}>
                    <td className="p-2">{p.label}</td>
                    <td className="p-2">{fmtDate(p.due)}</td>
                    <td className="p-2 text-right font-mono">{eur(p.output)}</td>
                    <td className="p-2 text-right font-mono">{eur(p.deductible)}</td>
                    <td className={`p-2 text-right font-mono ${p.payable < 0 ? 'text-emerald-300' : ''}`}>{eur(p.payable)}</td>
                    <td className="p-2">
                      {p.settled ? <span className="text-emerald-300">Tilitetty</span> : p.ended ? <span className="text-amber-300">Ilmoitettava</span> : <span className="text-slate-400">Kesken</span>}
                      {p.warnings > 0 && <AlertTriangle size={14} className="inline ml-2 text-amber-300" />}
                    </td>
                    <td className="p-2 text-right"><button type="button" className={smallButton} onClick={() => setOpen(open === p.key ? null : p.key)}>{open === p.key ? 'Sulje' : 'Avaa'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {periodsQ.isLoading && <div className="h-24 animate-pulse" />}
          </div>
        </div>
      )}

      {open && r && (
        <div className="glass-card p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="font-semibold text-lg">Kausiveroilmoitus {r.period.label}</div>
            <span className="text-sm text-slate-400">ilmoitus ja maksu viimeistään {fmtDate(r.period.due)}</span>
            {r.settlement && <span className="text-sm text-emerald-300 flex items-center gap-1"><CheckCircle size={14} />Tilitetty {fmtDate(r.settlement.entryDate)}</span>}
          </div>
          {r.warnings.map((w) => <div key={w} className="text-sm text-amber-300 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" />{w}</div>)}
          <table className="w-full text-sm max-w-3xl">
            <tbody>
              {r.fields.filter((f) => MAIN.includes(f.code) || f.amount !== 0)
                .sort((a, b) => (MAIN.indexOf(a.code) + 100) % 100 - (MAIN.indexOf(b.code) + 100) % 100 || a.code.localeCompare(b.code))
                .map((f) => (
                <tr key={f.code} className={`border-b border-white/5 ${f.code === '308' ? 'font-bold' : ''}`}>
                  <td className="p-2 text-slate-400 w-16">{f.code}</td>
                  <td className="p-2">{f.label}</td>
                  <td className="p-2 text-right font-mono">{eur(f.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <InfoBox>
            Ilmoita luvut OmaVerossa: Arvonlisävero → Kausiveroilmoitus, kausi {r.period.label}. Numerot vasemmalla ovat lomakkeen kenttätunnukset.
            Jos kaudella ei ollut toimintaa, valitse OmaVerossa "Ei toimintaa". ALV-tilitys siirtää kauden veron tilille 2885, josta maksu kirjataan.
          </InfoBox>
          <div className="flex flex-wrap gap-3">
            {canManage && !r.settlement && new Date(r.period.end) < new Date() && (
              <button type="button" className="premium-button premium-gradient text-white disabled:opacity-50" disabled={settle.isPending}
                onClick={() => { if (window.confirm(`Kirjataanko ALV-tilitys kaudelle ${r.period.label}? Maksettava ${eur(r.payable)}.`)) settle.mutate(r.period.key); }}>
                Kirjaa ALV-tilitys
              </button>
            )}
            {settingsQ.data?.softwareFileEnabled && (
              <button type="button" className={smallButton} disabled={download.isPending} onClick={() => download.mutate(r.period.key)}>
                <Download size={14} className="inline mr-1" />Ilmoitin.fi-tiedosto
              </button>
            )}
          </div>
        </div>
      )}

      <ErrorBox text={error} />
      {message && <div className="text-sm text-emerald-300">{message}</div>}
    </div>
  );
};

export default VatPage;
