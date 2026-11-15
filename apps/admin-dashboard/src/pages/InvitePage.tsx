import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ORG_ROLE_LABELS, acceptInvitation, getPublicInvitation } from '../api/organizations';

const input = 'w-full bg-slate-900/50 border border-white/10 rounded-xl py-3 px-4 focus:outline-none focus:border-primary-500 text-slate-100';

/** Kutsulinkin sivu: uusi käyttäjä asettaa salasanan, olemassa oleva vahvistaa omalla salasanallaan. */
const InvitePage = () => {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { acceptSession, logout, isAuthenticated } = useAuth();
  const [form, setForm] = useState({ firstName: '', lastName: '', password: '', mfaToken: '' });
  const [needMfa, setNeedMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: invitation, error: loadError, isLoading } = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => getPublicInvitation(token),
    retry: false,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await acceptInvitation(token, {
        password: form.password,
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        mfaToken: form.mfaToken || undefined,
      });
      if (data.mfaRequired) { setNeedMfa(true); return; }
      if (isAuthenticated) logout(); // toinen käyttäjä oli kirjautuneena tässä selaimessa
      queryClient.clear();
      acceptSession(data);
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Kutsun hyväksyntä epäonnistui');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md glass-card p-8 border border-white/10 space-y-6">
        {isLoading ? (
          <div className="text-slate-400">Ladataan kutsua…</div>
        ) : loadError || !invitation ? (
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">Kutsu ei kelpaa</h1>
            <p className="text-slate-400">{(loadError as any)?.response?.data?.error || 'Kutsua ei löytynyt.'}</p>
          </div>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-bold">Kutsu: {invitation.organizationName}</h1>
              <p className="text-slate-400 mt-2">
                Sinut on kutsuttu osoitteella <b className="text-slate-200">{invitation.email}</b>
                {invitation.orgRole ? ` toimiston rooliin ${ORG_ROLE_LABELS[invitation.orgRole]}` : ''}.
              </p>
              {invitation.companies.length > 0 && (
                <ul className="mt-3 text-sm text-slate-300 space-y-1">
                  {invitation.companies.map((c) => <li key={c.name}>{c.name}: {c.roleLabel}</li>)}
                </ul>
              )}
            </div>
            <form className="space-y-4" onSubmit={submit}>
              {!invitation.userExists && (
                <div className="grid grid-cols-2 gap-3">
                  <input className={input} placeholder="Etunimi" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                  <input className={input} placeholder="Sukunimi" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                </div>
              )}
              <input
                className={input}
                type="password"
                required
                minLength={8}
                placeholder={invitation.userExists ? 'Nykyinen salasanasi' : 'Valitse salasana (vähintään 8 merkkiä)'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              {needMfa && (
                <input className={input} inputMode="numeric" placeholder="Todennussovelluksen koodi" value={form.mfaToken}
                  onChange={(e) => setForm({ ...form, mfaToken: e.target.value })} />
              )}
              {error && <div className="text-sm text-red-400">{error}</div>}
              <button type="submit" disabled={busy} className="w-full premium-button premium-gradient text-white font-semibold">
                {busy ? 'Hetki…' : invitation.userExists ? 'Hyväksy kutsu' : 'Luo tunnus ja hyväksy'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default InvitePage;
