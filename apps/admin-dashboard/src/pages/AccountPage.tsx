import { useState } from 'react';
import type { FormEvent } from 'react';
import { KeyRound, LogOut, UserCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { companiesApi } from '../api/companies';
import { useAuth } from '../hooks/useAuth';

const errText = (err: any) => err?.response?.data?.error || 'Toiminto epäonnistui. Yritä hetken päästä uudelleen.';
const field = 'w-full bg-slate-900/50 border border-white/10 rounded-xl py-2.5 px-3 focus:outline-none focus:border-primary-500 text-slate-100';

/** Oma tili: salasanan vaihto ja uloskirjautuminen kaikilta laitteilta. */
const AccountPage = () => {
  const { user, token, acceptSession, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (next !== repeat) return setMessage({ ok: false, text: 'Uudet salasanat eivät täsmää' });
    setBusy(true);
    try {
      const { data } = await companiesApi.post('/auth/change-password', { currentPassword: current, newPassword: next });
      // Palvelin mitätöi vanhat tunnisteet ja antaa tälle laitteelle uuden
      if (data.token && user) acceptSession({ user, token: data.token });
      setCurrent(''); setNext(''); setRepeat('');
      setMessage({ ok: true, text: data.message || 'Salasana vaihdettu' });
    } catch (err) {
      setMessage({ ok: false, text: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  const logoutEverywhere = async () => {
    if (!window.confirm('Kirjataanko sinut ulos kaikilta laitteilta, myös tältä?')) return;
    try {
      await companiesApi.post('/auth/logout-all');
    } catch (err) {
      return setMessage({ ok: false, text: errText(err) });
    }
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center space-x-3">
        <UserCircle className="w-8 h-8 text-primary-400" />
        <div>
          <h2 className="text-2xl font-bold">Oma tili</h2>
          <p className="text-slate-400 text-sm">{user?.email}</p>
        </div>
      </div>

      <form onSubmit={changePassword} className="glass-card p-6 space-y-4">
        <h3 className="font-semibold flex items-center space-x-2"><KeyRound className="w-5 h-5" /><span>Vaihda salasana</span></h3>
        <p className="text-sm text-slate-400">Vaihdon jälkeen muut laitteet kirjataan ulos.</p>
        <label className="block text-sm space-y-1"><span className="text-slate-400">Nykyinen salasana</span>
          <input type="password" autoComplete="current-password" className={field} value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="block text-sm space-y-1"><span className="text-slate-400">Uusi salasana (vähintään 8 merkkiä)</span>
          <input type="password" autoComplete="new-password" className={field} value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
        </label>
        <label className="block text-sm space-y-1"><span className="text-slate-400">Uusi salasana uudelleen</span>
          <input type="password" autoComplete="new-password" className={field} value={repeat} onChange={(e) => setRepeat(e.target.value)} required minLength={8} />
        </label>
        {message && (
          <div className={`p-3 rounded-lg text-sm border ${message.ok ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>{message.text}</div>
        )}
        <button type="submit" disabled={busy || !token} className="px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-400 disabled:opacity-50 font-semibold">
          {busy ? 'Tallennetaan…' : 'Vaihda salasana'}
        </button>
      </form>

      <div className="glass-card p-6 space-y-3">
        <h3 className="font-semibold flex items-center space-x-2"><LogOut className="w-5 h-5" /><span>Kirjaudu ulos kaikkialta</span></h3>
        <p className="text-sm text-slate-400">Käytä, jos olet kirjautunut julkiselle tai kadonneelle laitteelle.</p>
        <button type="button" onClick={logoutEverywhere} className="px-4 py-2 rounded-xl border border-red-500/30 text-red-300 hover:bg-red-500/10 font-semibold">
          Kirjaudu ulos kaikilta laitteilta
        </button>
      </div>
    </div>
  );
};

export default AccountPage;
