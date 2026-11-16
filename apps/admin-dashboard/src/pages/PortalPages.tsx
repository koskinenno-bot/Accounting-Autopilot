import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle, Copy, LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { acceptPortalInvitation, getPortalInvitation, getPortalInvoices } from '../api/portal';
import type { PortalCompany, PortalInvoice } from '../api/portal';
import { eur, fmtDate, periodLabel } from '../components/fees/common';

const input = 'w-full bg-slate-900/50 border border-white/10 rounded-xl py-3 px-4 focus:outline-none focus:border-primary-500 text-slate-100';
const groupIban = (iban: string) => iban.replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim();
const groupRef = (ref: string) => ref.replace(/\s/g, '').replace(/\B(?=(\d{5})+(?!\d))/g, ' ');

const CopyButton = ({ text, label }: { text: string; label: string }) => {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="inline-flex items-center gap-1 text-xs text-primary-300 hover:text-primary-200"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* ei leikepöytää */ } }}>
      {done ? <CheckCircle className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{done ? 'Kopioitu' : label}
    </button>
  );
};

const InvoiceRow = ({ inv, company }: { inv: PortalInvoice; company: PortalCompany }) => {
  const [open, setOpen] = useState(false);
  const state = inv.open <= 0 ? { text: 'Maksettu', cls: 'text-emerald-300' }
    : inv.overdue ? { text: 'Erääntynyt', cls: 'text-rose-300' } : { text: 'Avoinna', cls: 'text-amber-200' };
  return (
    <div className="border-b border-white/5 py-3">
      <button type="button" className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 text-left text-sm" onClick={() => setOpen(!open)}>
        <span className="font-medium min-w-[9rem]">{inv.kind === 'FEE' ? `Vastike ${periodLabel(inv.period)}` : `Lasku ${inv.invoiceNumber}`}</span>
        <span className="text-slate-400">Huoneisto {inv.apartment}</span>
        <span className="text-slate-400">eräpäivä {fmtDate(inv.dueDate)}</span>
        <span className="ml-auto font-mono">{eur(inv.totalAmount)}</span>
        <span className={`w-24 text-right ${state.cls}`}>{state.text}</span>
      </button>
      {open && (
        <div className="mt-3 ml-1 space-y-2 text-sm">
          {inv.lines.map((l, i) => (
            <div key={i} className="flex justify-between text-slate-300 max-w-md"><span>{l.description}</span><span className="font-mono">{eur(l.amount)}</span></div>
          ))}
          {inv.payments.map((p, i) => (
            <div key={`p${i}`} className="text-emerald-300 text-xs">Maksettu {eur(p.amount)} {fmtDate(p.paidOn)}</div>
          ))}
          {inv.open > 0 && (
            <div className="mt-2 p-3 rounded-lg bg-white/5 space-y-1">
              <div>Maksettavaa <b>{eur(inv.open)}</b>, eräpäivä {fmtDate(inv.dueDate)}</div>
              {company.iban && <div>Saaja {company.companyName}, tili <span className="font-mono">{groupIban(company.iban)}</span></div>}
              {inv.referenceNumber && <div>Viite <span className="font-mono">{groupRef(inv.referenceNumber)}</span> <CopyButton text={inv.referenceNumber} label="Kopioi viite" /></div>}
              {inv.barcode && (
                <div className="pt-1">
                  <div className="text-xs text-slate-400">Virtuaaliviivakoodi (liitä verkkopankkiin, tiedot täyttyvät valmiiksi)</div>
                  <div className="font-mono text-xs break-all">{inv.barcode}</div>
                  <CopyButton text={inv.barcode} label="Kopioi virtuaaliviivakoodi" />
                </div>
              )}
              {!company.iban && <div className="text-amber-200 text-xs">Yhtiön tilinumero puuttuu. Kysy maksutiedot isännöitsijältä.</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Osakkaan oma sivu: huoneistojen vastikelaskut, avoin saldo ja maksutiedot. */
export const PortalPage = () => {
  const { isAuthenticated, logout } = useAuth();
  const { data, isLoading, error } = useQuery({ queryKey: ['portal'], queryFn: getPortalInvoices, enabled: isAuthenticated });
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  const name = data?.user ? [data.user.firstName, data.user.lastName].filter(Boolean).join(' ') || data.user.email : '';
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-3xl mx-auto p-4 sm:p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold">Osakasportaali</h1>
            {name && <p className="text-slate-400 text-sm">{name}</p>}
          </div>
          <button type="button" className="ml-auto inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white" onClick={logout}>
            <LogOut className="w-4 h-4" />Kirjaudu ulos
          </button>
        </div>
        {isLoading && <div className="text-slate-400">Ladataan…</div>}
        {error && <div className="text-rose-300">{(error as any)?.response?.data?.error || 'Laskujen haku epäonnistui'}</div>}
        {data && data.companies.length === 0 && (
          <div className="glass-card p-6 text-slate-300">Tunnukseesi ei ole liitetty huoneistoja. Ota yhteyttä isännöitsijään.</div>
        )}
        {data?.companies.map((c) => (
          <div key={c.companyId} className="glass-card p-5 space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-4">
              <h2 className="text-lg font-semibold">{c.companyName}</h2>
              <span className="text-sm text-slate-400">Huoneisto {c.apartments.join(', ')}</span>
            </div>
            <div className="flex flex-wrap gap-6 text-sm">
              <div>Avoinna <b className="text-lg">{eur(c.openTotal)}</b></div>
              {c.overdueTotal > 0 && <div className="text-rose-300">Erääntynyt {eur(c.overdueTotal)}</div>}
            </div>
            <div>
              {c.invoices.length === 0 ? <div className="text-sm text-slate-400">Ei laskuja.</div>
                : c.invoices.map((inv) => <InvoiceRow key={inv.id} inv={inv} company={c} />)}
            </div>
          </div>
        ))}
        <p className="text-xs text-slate-500">Tiedot päivittyvät, kun maksu näkyy taloyhtiön tiliotteella (yleensä 1–2 pankkipäivää).</p>
      </div>
    </div>
  );
};

/** Osakasportaalin kutsulinkki: tunnuksen luonti tai liittäminen olemassa olevaan tunnukseen. */
export const PortalInvitePage = () => {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { acceptSession, logout, isAuthenticated } = useAuth();
  const [form, setForm] = useState({ firstName: '', lastName: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: inv, error: loadError, isLoading } = useQuery({ queryKey: ['portalInvitation', token], queryFn: () => getPortalInvitation(token), retry: false });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await acceptPortalInvitation(token, { password: form.password, firstName: form.firstName || undefined, lastName: form.lastName || undefined });
      if (isAuthenticated) logout();
      queryClient.clear();
      acceptSession(data);
      navigate('/portal', { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Kutsun hyväksyntä epäonnistui');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md glass-card p-8 border border-white/10 space-y-6">
        {isLoading ? <div className="text-slate-400">Ladataan kutsua…</div>
          : loadError || !inv ? (
            <div className="space-y-2">
              <h1 className="text-2xl font-bold">Kutsu ei kelpaa</h1>
              <p className="text-slate-400">{(loadError as any)?.response?.data?.error || 'Kutsua ei löytynyt.'}</p>
            </div>
          ) : (
            <>
              <div>
                <h1 className="text-2xl font-bold">{inv.companyName}: osakasportaali</h1>
                <p className="text-slate-400 mt-2">
                  Huoneisto {inv.apartments || '–'} · <b className="text-slate-200">{inv.email}</b>. Portaalista näet vastikelaskut,
                  maksutilanteen ja maksutiedot.
                </p>
              </div>
              <form className="space-y-4" onSubmit={submit}>
                {!inv.userExists && (
                  <div className="grid grid-cols-2 gap-3">
                    <input className={input} placeholder="Etunimi" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                    <input className={input} placeholder="Sukunimi" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                  </div>
                )}
                <input className={input} type="password" required minLength={8} value={form.password}
                  placeholder={inv.userExists ? 'Nykyinen salasanasi' : 'Valitse salasana (vähintään 8 merkkiä)'}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
                {error && <div className="text-sm text-red-400">{error}</div>}
                <button type="submit" disabled={busy} className="w-full premium-button premium-gradient text-white font-semibold">
                  {busy ? 'Hetki…' : inv.userExists ? 'Liitä huoneisto tunnukseeni' : 'Luo tunnus'}
                </button>
              </form>
            </>
          )}
      </div>
    </div>
  );
};
