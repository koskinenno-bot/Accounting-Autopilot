import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle, Lock, Mail } from 'lucide-react';
import { checkPasswordReset, confirmPasswordReset, requestPasswordReset } from '../api/auth';

const errText = (err: any) => err?.response?.data?.error
  || (err?.response ? 'Palvelu vastasi virheellä. Yritä hetken päästä uudelleen.' : 'Kirjautumispalveluun ei saada yhteyttä. Onko palvelu käynnissä?');
const field = 'w-full bg-slate-900/50 border border-white/10 rounded-xl py-3 pl-11 pr-4 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-slate-100 placeholder:text-slate-600';

const Shell = ({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) => (
  <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
    <div className="w-full max-w-md">
      <div className="text-center mb-8">
        <div className="w-16 h-16 premium-gradient rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-2xl">
          <span className="text-3xl font-bold text-white">A</span>
        </div>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        <p className="text-slate-400 mt-2">{subtitle}</p>
      </div>
      <div className="glass-card p-8 border border-white/10 space-y-5">
        {children}
        <div className="pt-4 border-t border-white/5 text-center text-sm">
          <Link to="/login" className="text-primary-400 hover:text-primary-300 font-semibold">Takaisin kirjautumiseen</Link>
        </div>
      </div>
    </div>
  </div>
);

const ErrorText = ({ text }: { text: string | null }) =>
  text ? <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{text}</div> : null;

export const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string; devLink?: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await requestPasswordReset(email));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Salasanan vaihto" subtitle="Lähetämme sähköpostiisi linkin, jolla voit asettaa uuden salasanan.">
      {result ? (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm flex gap-2">
            <CheckCircle className="w-5 h-5 shrink-0" />{result.message}
          </div>
          {result.devLink && (
            <div className="text-xs text-slate-400 break-all">
              Kehitysympäristö (sähköposti ei lähde): <a className="text-primary-400" href={result.devLink}>avaa palautuslinkki</a>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <ErrorText text={error} />
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
            <input type="email" required className={field} placeholder="nimi@toimisto.fi" value={email}
              onChange={(e) => setEmail(e.target.value)} aria-label="Sähköposti" />
          </div>
          <button type="submit" disabled={busy} className="w-full premium-button premium-gradient text-white font-semibold disabled:opacity-50">
            {busy ? 'Lähetetään…' : 'Lähetä linkki'}
          </button>
        </form>
      )}
    </Shell>
  );
};

export const ResetPasswordPage = () => {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<{ loading: boolean; email?: string | null; error?: string }>({ loading: true });
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    checkPasswordReset(token)
      .then((r) => setState({ loading: false, email: r.email }))
      .catch((err) => setState({ loading: false, error: errText(err) }));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== repeat) { setError('Salasanat eivät täsmää'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await confirmPasswordReset(token, password);
      setDone(r.message);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Uusi salasana" subtitle={state.email ? `Käyttäjätunnus ${state.email}` : 'Aseta uusi salasana.'}>
      {state.loading && <div className="h-24 animate-pulse bg-white/5 rounded-xl" />}
      {state.error && (
        <div className="space-y-3">
          <ErrorText text={state.error} />
          <Link to="/forgot-password" className="text-sm text-primary-400">Pyydä uusi linkki</Link>
        </div>
      )}
      {done && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm flex gap-2">
          <CheckCircle className="w-5 h-5 shrink-0" />{done}
        </div>
      )}
      {!state.loading && !state.error && !done && (
        <form onSubmit={submit} className="space-y-4">
          <ErrorText text={error} />
          {[['Uusi salasana', password, setPassword], ['Toista salasana', repeat, setRepeat]].map(([label, value, set]: any) => (
            <div key={label} className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
              <input type="password" required minLength={8} autoComplete="new-password" className={field} placeholder={label}
                aria-label={label} value={value} onChange={(e) => set(e.target.value)} />
            </div>
          ))}
          <p className="text-xs text-slate-500">Vähintään 8 merkkiä.</p>
          <button type="submit" disabled={busy} className="w-full premium-button premium-gradient text-white font-semibold disabled:opacity-50">
            {busy ? 'Tallennetaan…' : 'Vaihda salasana'}
          </button>
        </form>
      )}
    </Shell>
  );
};
