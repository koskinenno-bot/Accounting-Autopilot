import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BASIS_LABELS, createComponent, createDefaultComponents, createPayoff, deletePayoff, updateComponent, updateReskontraSettings,
} from '../../api/fees';
import type { FeeBasis, FeeComponent, FeeSetup } from '../../api/fees';
import { ErrorBox, eur, errorText, fmtDate, inputClass, isoDay, smallButton } from './common';

const parseNum = (s: string) => Number(String(s).replace(/\s/g, '').replace(',', '.'));

const ComponentRow = ({ component, canManage, onSaved }: { component: FeeComponent; canManage: boolean; onSaved: () => void }) => {
  const [draft, setDraft] = useState({
    name: component.name,
    basis: component.basis,
    unitPrice: String(component.unitPrice).replace('.', ','),
    accountNumber: component.accountNumber,
    loanCapital: component.loanCapital,
    loanAmount: component.loanAmount === null ? '' : String(component.loanAmount).replace('.', ','),
    isActive: component.isActive,
    vatRate: String(component.vatRate ?? 0),
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => updateComponent(component.id, {
      ...draft,
      unitPrice: parseNum(draft.unitPrice),
      loanAmount: draft.loanAmount === '' ? null : parseNum(draft.loanAmount),
      vatRate: Number(draft.vatRate),
    }),
    onSuccess: () => { setError(null); setSaved(true); onSaved(); },
    onError: (err) => setError(errorText(err)),
  });
  const set = (patch: Partial<typeof draft>) => { setDraft((d) => ({ ...d, ...patch })); setSaved(false); };

  return (
    <tr className={`border-b border-white/5 align-top ${draft.isActive ? '' : 'opacity-60'}`}>
      <td className="p-2"><input className={`${inputClass} w-44`} disabled={!canManage} value={draft.name} onChange={(e) => set({ name: e.target.value })} /></td>
      <td className="p-2">
        <select className={inputClass} disabled={!canManage} value={draft.basis} onChange={(e) => set({ basis: e.target.value as FeeBasis })}>
          {Object.entries(BASIS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </td>
      <td className="p-2"><input className={`${inputClass} w-24 text-right`} disabled={!canManage} value={draft.unitPrice} onChange={(e) => set({ unitPrice: e.target.value })} /></td>
      <td className="p-2"><input className={`${inputClass} w-20`} disabled={!canManage} value={draft.accountNumber} onChange={(e) => set({ accountNumber: e.target.value })} /></td>
      <td className="p-2">
        <select className={inputClass} disabled={!canManage} value={draft.vatRate} aria-label={`ALV ${component.name}`}
          title="Veroton vastike (0 %) tai verollinen vuokra, kun yhtiö on hakeutunut ALV-velvolliseksi. Hinta on veroton."
          onChange={(e) => set({ vatRate: e.target.value })}>
          <option value="0">0 %</option>
          <option value="25.5">25,5 %</option>
          <option value="13.5">13,5 %</option>
          <option value="10">10 %</option>
        </select>
      </td>
      <td className="p-2 text-sm">
        <label className="flex items-center gap-2 whitespace-nowrap">
          <input type="checkbox" disabled={!canManage} checked={draft.loanCapital} onChange={(e) => set({ loanCapital: e.target.checked })} />
          Rahoitusvastike
        </label>
        {draft.loanCapital && (
          <input className={`${inputClass} w-32 mt-1`} disabled={!canManage} placeholder="Lainan pääoma €" value={draft.loanAmount}
            onChange={(e) => set({ loanAmount: e.target.value })} />
        )}
      </td>
      <td className="p-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" disabled={!canManage} checked={draft.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          Käytössä
        </label>
      </td>
      <td className="p-2 text-right whitespace-nowrap">
        {canManage && <button type="button" className={smallButton} disabled={save.isPending} onClick={() => save.mutate()}>Tallenna</button>}
        {saved && <div className="text-xs text-emerald-400 mt-1">Tallennettu</div>}
        {error && <div className="text-xs text-rose-300 mt-1 max-w-48 whitespace-normal">{error}</div>}
      </td>
    </tr>
  );
};

const SettingsForm = ({ companyId, setup, canManage, onSaved }: { companyId: string; setup: FeeSetup; canManage: boolean; onSaved: () => void }) => {
  const s = setup.settings;
  const [draft, setDraft] = useState({
    referenceRate: String(s.referenceRate).replace('.', ','),
    reminderFee: String(s.reminderFee).replace('.', ','),
    reminderDaysAfterDue: String(s.reminderDaysAfterDue),
    paymentTermDays: String(s.paymentTermDays),
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => updateReskontraSettings({
      companyId,
      referenceRate: parseNum(draft.referenceRate),
      reminderFee: parseNum(draft.reminderFee),
      reminderDaysAfterDue: Number(draft.reminderDaysAfterDue),
      paymentTermDays: Number(draft.paymentTermDays),
    }),
    onSuccess: () => { setError(null); setSaved(true); onSaved(); },
    onError: (err) => setError(errorText(err)),
  });
  const field = (key: keyof typeof draft, label: string, hint: string) => (
    <label className="text-sm space-y-1">
      <div className="text-slate-400">{label}</div>
      <input className={`${inputClass} w-28`} disabled={!canManage} value={draft[key]}
        onChange={(e) => { setDraft((d) => ({ ...d, [key]: e.target.value })); setSaved(false); }} />
      <div className="text-xs text-slate-500">{hint}</div>
    </label>
  );
  return (
    <div className="glass-card p-5 space-y-3">
      <h3 className="font-semibold">Viivästyskorko ja muistutukset</h3>
      <div className="flex flex-wrap gap-6">
        {field('referenceRate', 'Viitekorko %', 'Suomen Pankki vahvistaa puolivuosittain')}
        {field('reminderFee', 'Muistutusmaksu €', 'Enintään 5 € (perintälaki)')}
        {field('reminderDaysAfterDue', 'Muistutus päivää eräpäivästä', 'Esim. 14')}
        {field('paymentTermDays', 'Muistutuksen maksuaika pv', 'Vähintään 14')}
      </div>
      <p className="text-xs text-slate-500">
        Viivästyskorko on viitekorko + 7 prosenttiyksikköä (korkolaki 4 §). Tarkista voimassa oleva viitekorko Suomen Pankin sivuilta.
      </p>
      {canManage && <button type="button" className={smallButton} disabled={save.isPending} onClick={() => save.mutate()}>Tallenna asetukset</button>}
      {saved && <span className="ml-3 text-sm text-emerald-400">Tallennettu</span>}
      <ErrorBox text={error} />
    </div>
  );
};

const LoanShares = ({ companyId, setup, canManage, onSaved }: { companyId: string; setup: FeeSetup; canManage: boolean; onSaved: () => void }) => {
  const loans = setup.components.filter((c) => c.loanCapital && c.loanAmount);
  const [error, setError] = useState<string | null>(null);
  const pay = useMutation({
    mutationFn: (v: { apartment: string; componentId: string; amount: number }) =>
      createPayoff({ companyId, ...v, paidOn: isoDay(new Date()) }),
    onSuccess: () => { setError(null); onSaved(); },
    onError: (err) => setError(errorText(err)),
  });
  const undo = useMutation({ mutationFn: deletePayoff, onSuccess: onSaved, onError: (err) => setError(errorText(err)) });

  if (!loans.length) {
    return (
      <div className="glass-card p-5 text-sm text-slate-400">
        Lainaosuudet: merkitse rahoitusvastikkeelle lainan pääoma, niin huoneistojen lainaosuudet lasketaan osakkeiden suhteessa.
      </div>
    );
  }
  return (
    <div className="glass-card p-5 space-y-3 overflow-x-auto">
      <h3 className="font-semibold">Lainaosuudet</h3>
      <p className="text-xs text-slate-500">
        Osuus = lainan pääoma × huoneiston osakkeet / kaikki osakkeet ({setup.totalShares.toLocaleString('fi-FI')} kpl). Pois maksanut huoneisto
        ei enää maksa kyseistä rahoitusvastiketta seuraavissa laskutusajoissa.
      </p>
      <ErrorBox text={error} />
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-400 border-b border-white/5">
            <th className="p-2 font-medium">Huoneisto</th>
            <th className="p-2 font-medium text-right">Osakkeet</th>
            {loans.map((l) => <th key={l.id} className="p-2 font-medium text-right">{l.name} ({eur(l.loanAmount ?? 0)})</th>)}
          </tr>
        </thead>
        <tbody>
          {setup.apartments.map((a) => (
            <tr key={a.apartment} className="border-b border-white/5">
              <td className="p-2 font-semibold">{a.apartment}</td>
              <td className="p-2 text-right">{a.shares.toLocaleString('fi-FI')}</td>
              {loans.map((l) => {
                const share = a.loanShares.find((s) => s.componentId === l.id);
                const payoff = setup.payoffs.find((p) => p.apartment === a.apartment && p.componentId === l.id);
                return (
                  <td key={l.id} className="p-2 text-right">
                    <div className="font-mono">{eur(share?.amount ?? 0)}</div>
                    {payoff ? (
                      <div className="text-xs text-emerald-400">
                        Maksettu pois {fmtDate(payoff.paidOn)}
                        {canManage && <button type="button" className="ml-2 text-slate-400 hover:text-white" onClick={() => undo.mutate(payoff.id)}>Peru</button>}
                      </div>
                    ) : canManage && (share?.amount ?? 0) > 0 && (
                      <button type="button" className="text-xs text-primary-400 hover:text-primary-300"
                        onClick={() => pay.mutate({ apartment: a.apartment, componentId: l.id, amount: share!.amount })}>
                        Merkitse maksetuksi
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const SetupTab = ({ companyId, setup, canManage, onSaved }: { companyId: string; setup: FeeSetup; canManage: boolean; onSaved: () => void }) => {
  const [error, setError] = useState<string | null>(null);
  const defaults = useMutation({ mutationFn: () => createDefaultComponents(companyId), onSuccess: onSaved, onError: (e) => setError(errorText(e)) });
  const add = useMutation({
    mutationFn: () => createComponent({ companyId, name: 'Uusi vastike', basis: 'FIXED', unitPrice: 0, accountNumber: '3600' }),
    onSuccess: onSaved,
    onError: (e) => setError(errorText(e)),
  });

  return (
    <div className="space-y-6">
      <div className="glass-card p-5 space-y-3 overflow-x-auto">
        <h3 className="font-semibold">Vastikeperusteet</h3>
        {!canManage && <p className="text-sm text-slate-400">Vastikeperusteita voi muuttaa vain yhtiön isännöitsijä.</p>}
        <ErrorBox text={error} />
        {setup.components.length === 0 ? (
          <div className="text-sm text-slate-400 space-y-3">
            <p>Yhtiölle ei ole vielä asetettu vastikeperusteita.</p>
            {canManage && (
              <button type="button" className="premium-button premium-gradient text-white" onClick={() => defaults.mutate()}>
                Luo perusteet: hoito-, rahoitus- ja vesivastike sekä autopaikat
              </button>
            )}
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-white/5">
                  <th className="p-2 font-medium">Nimi</th>
                  <th className="p-2 font-medium">Peruste</th>
                  <th className="p-2 font-medium">Hinta</th>
                  <th className="p-2 font-medium">Tulotili</th>
                  <th className="p-2 font-medium">ALV</th>
                  <th className="p-2 font-medium">Laina</th>
                  <th className="p-2 font-medium" />
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {setup.components.map((c) => <ComponentRow key={c.id} component={c} canManage={canManage} onSaved={onSaved} />)}
              </tbody>
            </table>
            {canManage && <button type="button" className={smallButton} onClick={() => add.mutate()}>Lisää vastikelaji</button>}
          </>
        )}
      </div>
      <LoanShares companyId={companyId} setup={setup} canManage={canManage} onSaved={onSaved} />
      <SettingsForm key={JSON.stringify(setup.settings)} companyId={companyId} setup={setup} canManage={canManage} onSaved={onSaved} />
    </div>
  );
};

export default SetupTab;
