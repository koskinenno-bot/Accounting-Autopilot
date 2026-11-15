import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, Landmark, RefreshCw } from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import {
  completeBankConnection, getAspsps, getBankConnections, removeBankConnection, setBankAccountEnabled, startBankConnection, syncBankConnection,
} from '../api/bank';
import type { BankConnection } from '../api/bank';
import { ErrorBox, InfoBox, eur, fmtDate, inputClass, isoDay, smallButton } from '../components/fees/common';

const errText = (err: any) => err?.response?.data?.error || err?.message || 'Toiminto epäonnistui';
const fmtTime = (d: string | null) => (d ? new Date(d).toLocaleString('fi-FI', { dateStyle: 'short', timeStyle: 'short' }) : '–');
const daysLeft = (d: string) => Math.ceil((new Date(d).getTime() - Date.now()) / 86400_000);
const ibanFmt = (iban: string | null) => (iban ? iban.replace(/(.{4})/g, '$1 ').trim() : '–');

const STATUS: Record<BankConnection['status'], { text: string; cls: string }> = {
  ACTIVE: { text: 'Voimassa', cls: 'bg-emerald-500/15 text-emerald-300' },
  PENDING: { text: 'Odottaa tunnistusta', cls: 'bg-amber-500/15 text-amber-300' },
  EXPIRED: { text: 'Vanhentunut', cls: 'bg-rose-500/15 text-rose-300' },
  FAILED: { text: 'Keskeytyi', cls: 'bg-rose-500/15 text-rose-300' },
  REVOKED: { text: 'Poistettu', cls: 'bg-white/5 text-slate-400' },
};

/** Pankkiyhteydet: tilit yhdistetään kerran pankkitunnuksilla, sen jälkeen tapahtumat haetaan automaattisesti. */
const BankConnectionsPage = () => {
  const { selectedCompany, canManage, canWrite } = useCompany();
  const companyId = selectedCompany?.id;
  const queryClient = useQueryClient();
  const [bank, setBank] = useState('');
  const [psuType, setPsuType] = useState('business');
  const [syncFrom, setSyncFrom] = useState(isoDay(new Date(Date.now() - 30 * 86400_000)));
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['bankConnections', companyId], queryFn: () => getBankConnections(companyId!), enabled: !!companyId,
  });
  const aspsps = useQuery({ queryKey: ['aspsps'], queryFn: () => getAspsps('FI'), enabled: !!data?.configured && canManage, staleTime: 3600_000 });
  const banks = useMemo(() => [...(aspsps.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'fi')), [aspsps.data]);
  const selected = banks.find((b) => b.name === bank);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['bankConnections', companyId] });
  const flash = (text: string) => { setMessage(text); setTimeout(() => setMessage(null), 5000); };

  const start = useMutation({
    mutationFn: (aspspName: string) => startBankConnection({ companyId: companyId!, aspspName, aspspCountry: 'FI', psuType, syncFrom }),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (err) => setError(errText(err)),
  });
  const sync = useMutation({
    mutationFn: syncBankConnection,
    onSuccess: (r) => {
      setError(null);
      flash(r.imported ? `Haettiin ${r.imported} tapahtumaa. Ne kirjautuvat kirjanpitoon ja reskontraan hetken kuluttua.` : 'Ei uusia tapahtumia.');
      refresh();
    },
    onError: (err) => setError(errText(err)),
  });
  const toggle = useMutation({
    mutationFn: (v: { connectionId: string; accountId: string; enabled: boolean }) => setBankAccountEnabled(v.connectionId, v.accountId, v.enabled),
    onSuccess: refresh,
    onError: (err) => setError(errText(err)),
  });
  const remove = useMutation({
    mutationFn: removeBankConnection,
    onSuccess: (r) => { setError(r.warning ?? null); flash('Pankkiyhteys poistettu. Jo kirjatut tapahtumat säilyvät.'); refresh(); },
    onError: (err) => setError(errText(err)),
  });

  if (!selectedCompany) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Pankkiyhteydet</h2>
        <p className="text-slate-400 mt-1">
          Yhtiön pankkitili yhdistetään kerran pankkitunnuksilla. Sen jälkeen tapahtumat haetaan automaattisesti
          kirjanpitoon ja vastikereskontraan, eikä tiliotteita tarvitse ladata käsin.
        </p>
      </div>

      {isLoading && <div className="glass-card h-40 animate-pulse" />}

      {data && !data.configured && (
        <div className="glass-card p-5 space-y-2 border border-amber-500/30">
          <div className="flex items-center gap-2 font-semibold text-amber-200"><AlertTriangle size={18} />Pankkiyhteyttä ei ole vielä otettu käyttöön</div>
          <ol className="list-decimal ml-5 text-sm text-slate-300 space-y-1">
            <li>Rekisteröi sovellus Enable Bankingin hallintapaneelissa (enablebanking.com/cp, kohta API applications).</li>
            <li>Lisää paluuosoitteeksi (Redirect URL): <code className="text-slate-100">{data.redirectUrl}</code></li>
            <li>Siirrä ladattu <code>.pem</code>-tiedosto kansioon <code>apps\bank-service\salaiset\</code> ja käynnistä sovellus uudelleen.</li>
          </ol>
          <p className="text-sm text-slate-400">Siihen asti tiliotteet voi tuoda tiedostona (camt.053, CSV tai PDF) Käsittelemättömät-sivulla.</p>
        </div>
      )}

      {data?.configured && (
        <>
          {data.connections.length === 0 && (
            <InfoBox>Yhtiöllä ei ole vielä pankkiyhteyttä. {canManage ? 'Yhdistä tili alla.' : 'Isännöitsijä voi yhdistää tilin.'}</InfoBox>
          )}

          {data.connections.map((c) => {
            const st = STATUS[c.status];
            const left = daysLeft(c.validUntil);
            return (
              <div key={c.id} className="glass-card p-5 space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Landmark size={20} className="text-primary-300" />
                  <div className="font-semibold text-lg">{c.aspspName}</div>
                  <span className={`px-2 py-0.5 rounded text-xs ${st.cls}`}>{st.text}</span>
                  {c.status === 'ACTIVE' && (
                    <span className={`text-sm ${left <= 14 ? 'text-amber-300' : 'text-slate-400'}`}>
                      Suostumus voimassa {fmtDate(c.validUntil)} asti{left <= 14 ? ` (${left} pv). Yhdistä uudelleen ennen tätä.` : ''}
                    </span>
                  )}
                  <div className="ml-auto flex gap-2">
                    {c.status === 'ACTIVE' && canWrite && (
                      <button type="button" className={smallButton} disabled={sync.isPending} onClick={() => sync.mutate(c.id)}>
                        <RefreshCw size={14} className={`inline mr-1 ${sync.isPending ? 'animate-spin' : ''}`} />Hae nyt
                      </button>
                    )}
                    {(c.status === 'EXPIRED' || (c.status === 'ACTIVE' && left <= 14)) && canManage && (
                      <button type="button" className={smallButton} disabled={start.isPending} onClick={() => start.mutate(c.aspspName)}>Yhdistä uudelleen</button>
                    )}
                    {canManage && (
                      <button type="button" className={`${smallButton} text-rose-300`} disabled={remove.isPending}
                        onClick={() => { if (window.confirm(`Poistetaanko pankkiyhteys ${c.aspspName}? Suostumus perutaan pankissa. Kirjatut tapahtumat säilyvät.`)) remove.mutate(c.id); }}>
                        Poista
                      </button>
                    )}
                  </div>
                </div>
                {c.lastError && <div className="text-sm text-rose-300">{c.lastError}</div>}
                {c.accounts.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-slate-400 border-b border-white/5">
                          <th className="p-2 font-medium">Tili</th>
                          <th className="p-2 font-medium text-right">Saldo pankissa</th>
                          <th className="p-2 font-medium">Viimeisin haku</th>
                          <th className="p-2 font-medium text-right">Uusia viime haussa</th>
                          <th className="p-2 font-medium">Haku käytössä</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.accounts.map((a) => (
                          <tr key={a.id} className="border-b border-white/5">
                            <td className="p-2"><div className="font-mono">{ibanFmt(a.iban)}</div><div className="text-xs text-slate-400">{a.name}</div></td>
                            <td className="p-2 text-right font-mono">{a.balance == null ? '–' : eur(a.balance)}</td>
                            <td className="p-2 text-slate-300">{fmtTime(a.lastSyncAt)}</td>
                            <td className="p-2 text-right text-slate-300">{a.lastSyncAt ? `${a.lastImported} tapahtumaa` : '–'}</td>
                            <td className="p-2">
                              <input type="checkbox" checked={a.enabled} disabled={!canManage || toggle.isPending} aria-label={`Haku ${a.iban}`}
                                onChange={(e) => toggle.mutate({ connectionId: c.id, accountId: a.id, enabled: e.target.checked })} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="text-xs text-slate-500">
                  Tapahtumat {fmtDate(c.syncFrom)} alkaen · yhdistetty {fmtDate(c.createdAt)} · haettu viimeksi {fmtTime(c.lastSyncAt)} · automaattinen haku muutaman tunnin välein
                </div>
              </div>
            );
          })}

          {canManage && (
            <div className="glass-card p-5 space-y-4">
              <div className="font-semibold">Yhdistä pankkitili</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="text-sm text-slate-300 space-y-1">
                  <div>Pankki</div>
                  <select aria-label="Pankki" className={`${inputClass} w-full`} value={bank} onChange={(e) => setBank(e.target.value)} disabled={aspsps.isLoading}>
                    <option value="">{aspsps.isLoading ? 'Haetaan pankkeja…' : 'Valitse pankki'}</option>
                    {banks.map((b) => <option key={b.name} value={b.name}>{b.name}{b.beta ? ' (beta)' : ''}</option>)}
                  </select>
                </label>
                <label className="text-sm text-slate-300 space-y-1">
                  <div>Tilin omistaja</div>
                  <select className={`${inputClass} w-full`} value={psuType} onChange={(e) => setPsuType(e.target.value)}>
                    <option value="business">Yhtiö (yritystunnukset)</option>
                    <option value="personal">Henkilötunnukset</option>
                  </select>
                </label>
                <label className="text-sm text-slate-300 space-y-1">
                  <div>Hae tapahtumat alkaen</div>
                  <input type="date" className={`${inputClass} w-full`} value={syncFrom} max={isoDay(new Date())} onChange={(e) => setSyncFrom(e.target.value)} />
                </label>
              </div>
              {selected && selected.psuTypes.length > 0 && !selected.psuTypes.includes(psuType) && (
                <div className="text-sm text-amber-300">{selected.name} ei tue valittua tunnistustapaa tämän palvelun kautta.</div>
              )}
              {aspsps.error && <div className="text-sm text-rose-300">{errText(aspsps.error)}</div>}
              <div className="text-sm text-slate-400">
                Sinut ohjataan pankin tunnistautumiseen. Pankki kysyy luvan näyttää tilitiedot (enintään 180 päivää). Hae aloituspäivä niin, että
                aiemmin tiliotteina tuodut tapahtumat eivät jää väliin; sama tapahtuma ei kirjaudu kahdesti.
              </div>
              <button type="button" className="premium-button premium-gradient text-white disabled:opacity-50"
                disabled={!bank || start.isPending} onClick={() => { setError(null); start.mutate(bank); }}>
                {start.isPending ? 'Siirrytään pankkiin…' : 'Yhdistä pankkiin'}
              </button>
            </div>
          )}
        </>
      )}

      <ErrorBox text={error} />
      {message && <div className="text-sm text-emerald-300">{message}</div>}
    </div>
  );
};

const handledStates = new Set<string>();

/** Paluu pankista: /bank-connections/callback?code=…&state=… (tai ?error=…). */
export const BankCallbackPage = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { selectCompany } = useCompany();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const state = params.get('state');
    if (started.current || !state || handledStates.has(state)) return;
    started.current = true;
    handledStates.add(state);
    completeBankConnection({ state, code: params.get('code'), error: params.get('error'), error_description: params.get('error_description') })
      .then((r) => {
        selectCompany(r.companyId);
        queryClient.invalidateQueries({ queryKey: ['bankConnections'] });
        const n = r.connection.accounts.length;
        setResult({ ok: true, text: `${r.connection.aspspName} yhdistetty: ${n} ${n === 1 ? 'tili' : 'tiliä'}, ${r.imported ?? 0} tapahtumaa haettu.` });
        setTimeout(() => navigate('/bank-connections', { replace: true }), 2500);
      })
      .catch((err) => {
        if (err?.response?.data?.companyId) selectCompany(err.response.data.companyId);
        setResult({ ok: false, text: errText(err) });
      });
  }, [params, navigate, selectCompany, queryClient]);

  return (
    <div className="glass-card p-8 max-w-xl mx-auto mt-10 text-center space-y-4">
      {!params.get('state') && <div className="text-rose-300">Paluuosoitteesta puuttuu tunniste. Aloita yhdistäminen uudelleen.</div>}
      {params.get('state') && !result && <div className="text-slate-300">Viimeistellään pankkiyhteyttä ja haetaan tapahtumia…</div>}
      {result && (
        <div className={`flex items-center justify-center gap-2 ${result.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
          {result.ok ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}{result.text}
        </div>
      )}
      <Link to="/bank-connections" className={smallButton}>Pankkiyhteydet</Link>
    </div>
  );
};

export default BankConnectionsPage;
