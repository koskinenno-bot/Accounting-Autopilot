import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Trash2, UserPlus, Pencil, X } from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import { useAuth } from '../hooks/useAuth';
import type { CompanyRole, CompanyRoleAssignment, OrgRole } from '../api/organizations';
import {
  COMPANY_ROLE_LABELS, ORG_ROLE_LABELS,
  cancelInvitation, createInvitation, getInvitations, getOrganizationUsers, removeUser, updateUserAccess,
} from '../api/organizations';

const errorText = (err: any) => err?.response?.data?.error || 'Toiminto epäonnistui';

interface AccessDraft { orgRole: OrgRole | null; companyRoles: CompanyRoleAssignment[] }

/** Toimiston rooli + yhtiökohtaiset roolit. Käytetään sekä kutsussa että muokkauksessa. */
const AccessEditor = ({ value, onChange, allowOwner }: { value: AccessDraft; onChange: (v: AccessDraft) => void; allowOwner: boolean }) => {
  const { companies } = useCompany();
  const ownCompanies = companies ?? [];
  const roleFor = (id: string) => value.companyRoles.find((r) => r.companyId === id)?.role;
  const setRole = (companyId: string, role: CompanyRole | '') => {
    const rest = value.companyRoles.filter((r) => r.companyId !== companyId);
    onChange({ ...value, companyRoles: role ? [...rest, { companyId, role }] : rest });
  };
  const setAll = (role: CompanyRole | '') =>
    onChange({ ...value, companyRoles: role ? ownCompanies.map((c) => ({ companyId: c.id, role })) : [] });
  const orgAdmin = value.orgRole === 'OWNER' || value.orgRole === 'ADMIN';

  return (
    <div className="space-y-4">
      <label className="block space-y-1">
        <span className="text-sm text-slate-400">Toimiston rooli</span>
        <select
          value={value.orgRole ?? ''}
          onChange={(e) => onChange({ ...value, orgRole: (e.target.value || null) as OrgRole | null })}
          className="w-full bg-slate-900/50 border border-white/10 rounded-xl py-2 px-3 text-sm"
        >
          <option value="">Ei toimiston jäsen (esim. hallitus, tilintarkastaja)</option>
          <option value="MEMBER">{ORG_ROLE_LABELS.MEMBER}: näkee vain alla valitut yhtiöt</option>
          <option value="ADMIN">{ORG_ROLE_LABELS.ADMIN}: kaikki yhtiöt ja käyttäjät</option>
          {allowOwner && <option value="OWNER">{ORG_ROLE_LABELS.OWNER}</option>}
        </select>
      </label>

      {orgAdmin ? (
        <p className="text-sm text-slate-400">Pääkäyttäjällä ja omistajalla on isännöitsijän oikeudet kaikkiin toimiston yhtiöihin.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Oikeudet yhtiöihin</span>
            <select onChange={(e) => { setAll(e.target.value as CompanyRole | ''); e.target.value = 'x'; }} defaultValue="x"
              className="bg-slate-900/50 border border-white/10 rounded-lg py-1 px-2 text-xs">
              <option value="x" disabled>Aseta kaikille…</option>
              <option value="">Ei mitään</option>
              {(Object.keys(COMPANY_ROLE_LABELS) as CompanyRole[]).map((r) => <option key={r} value={r}>{COMPANY_ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <div className="max-h-64 overflow-y-auto border border-white/5 rounded-xl divide-y divide-white/5">
            {ownCompanies.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="truncate mr-3">{c.name}</span>
                <select
                  value={roleFor(c.id) ?? ''}
                  onChange={(e) => setRole(c.id, e.target.value as CompanyRole | '')}
                  className="bg-slate-900/50 border border-white/10 rounded-lg py-1 px-2 text-xs"
                >
                  <option value="">Ei pääsyä</option>
                  {(Object.keys(COMPANY_ROLE_LABELS) as CompanyRole[]).map((r) => <option key={r} value={r}>{COMPANY_ROLE_LABELS[r]}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const Modal = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
    <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />
    <div className="w-full max-w-lg glass-card p-6 relative z-10 border border-white/10 max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-xl font-bold">{title}</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
      </div>
      {children}
    </div>
  </div>
);

const UsersPage = () => {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const { organization, orgRole, isOrgAdmin } = useCompany();
  const orgId = organization?.id;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteAccess, setInviteAccess] = useState<AccessDraft>({ orgRole: 'MEMBER', companyRoles: [] });
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; email: string; access: AccessDraft } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const users = useQuery({ queryKey: ['org-users', orgId], queryFn: () => getOrganizationUsers(orgId!), enabled: !!orgId && isOrgAdmin });
  const invitations = useQuery({ queryKey: ['org-invitations', orgId], queryFn: () => getInvitations(orgId!), enabled: !!orgId && isOrgAdmin });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['org-users'] });
    queryClient.invalidateQueries({ queryKey: ['org-invitations'] });
    queryClient.invalidateQueries({ queryKey: ['companies'] });
  };

  const invite = useMutation({
    mutationFn: () => createInvitation(orgId!, { email: inviteEmail, ...inviteAccess }),
    onSuccess: (data) => { setCreatedLink(data.link); setError(null); refresh(); },
    onError: (err) => setError(errorText(err)),
  });
  const save = useMutation({
    mutationFn: () => updateUserAccess(orgId!, editing!.id, editing!.access),
    onSuccess: () => { setEditing(null); setError(null); refresh(); },
    onError: (err) => setError(errorText(err)),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => removeUser(orgId!, userId),
    onSuccess: refresh,
    onError: (err) => alert(errorText(err)),
  });
  const cancel = useMutation({ mutationFn: (id: string) => cancelInvitation(orgId!, id), onSuccess: refresh });

  const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => undefined);

  if (!isOrgAdmin || !orgId) {
    return <div className="glass-card p-8 text-center text-slate-400">Käyttäjiä voi hallita vain toimiston omistaja tai pääkäyttäjä.</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Käyttäjät</h2>
          <p className="text-slate-400 mt-1">Toimiston työntekijät sekä yhtiöiden hallitukset ja tarkastajat.</p>
        </div>
        <button type="button" onClick={() => { setInviteOpen(true); setCreatedLink(null); setInviteEmail(''); setError(null); }}
          className="premium-button premium-gradient text-white flex items-center space-x-2">
          <UserPlus className="w-5 h-5" /><span>Kutsu käyttäjä</span>
        </button>
      </div>

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-white/5">
              <th className="p-4 font-medium">Käyttäjä</th>
              <th className="p-4 font-medium">Toimiston rooli</th>
              <th className="p-4 font-medium">Yhtiöt</th>
              <th className="p-4" />
            </tr>
          </thead>
          <tbody>
            {(users.data ?? []).map((u) => (
              <tr key={u.id} className="border-b border-white/5 align-top">
                <td className="p-4">
                  <div className="font-semibold">{[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}</div>
                  <div className="text-xs text-slate-500">{u.email}{u.id === me?.id ? ' (sinä)' : ''}</div>
                </td>
                <td className="p-4 text-slate-300">{u.orgRole ? ORG_ROLE_LABELS[u.orgRole] : 'Ulkopuolinen'}</td>
                <td className="p-4 text-slate-300">
                  {u.orgRole === 'OWNER' || u.orgRole === 'ADMIN'
                    ? 'Kaikki yhtiöt (isännöitsijä)'
                    : u.companyRoles.length === 0
                      ? <span className="text-slate-500">Ei yhtiöitä</span>
                      : u.companyRoles.map((r) => <div key={r.companyId}>{r.companyName}: {COMPANY_ROLE_LABELS[r.role] ?? r.role}</div>)}
                </td>
                <td className="p-4 text-right whitespace-nowrap">
                  <button type="button" title="Muokkaa oikeuksia" className="text-slate-400 hover:text-white mr-3"
                    onClick={() => { setError(null); setEditing({ id: u.id, email: u.email, access: { orgRole: u.orgRole, companyRoles: u.companyRoles.map(({ companyId, role }) => ({ companyId, role })) } }); }}>
                    <Pencil className="w-4 h-4" />
                  </button>
                  {u.id !== me?.id && (
                    <button type="button" title="Poista toimistosta" className="text-slate-400 hover:text-red-400"
                      onClick={() => { if (confirm(`Poistetaanko ${u.email} toimistosta ja kaikista sen yhtiöistä?`)) remove.mutate(u.id); }}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.isLoading && <div className="p-6 text-slate-400">Ladataan…</div>}
      </div>

      {(invitations.data?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">Avoimet kutsut</h3>
          <div className="glass-card divide-y divide-white/5">
            {invitations.data!.map((i) => (
              <div key={i.id} className="flex items-center justify-between p-4 text-sm">
                <div>
                  <div className="font-semibold">{i.email}</div>
                  <div className="text-xs text-slate-500">
                    {i.orgRole ? ORG_ROLE_LABELS[i.orgRole] : 'Ulkopuolinen'} · {i.companyRoles.length} yhtiötä · voimassa {new Date(i.expiresAt).toLocaleDateString('fi-FI')} asti
                  </div>
                </div>
                <div className="whitespace-nowrap">
                  <button type="button" onClick={() => copy(i.link)} className="text-primary-400 hover:text-primary-300 mr-4 inline-flex items-center">
                    <Copy className="w-4 h-4 mr-1" />Kopioi linkki
                  </button>
                  <button type="button" onClick={() => cancel.mutate(i.id)} className="text-slate-400 hover:text-red-400">Peru</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {inviteOpen && (
        <Modal title="Kutsu käyttäjä" onClose={() => setInviteOpen(false)}>
          {createdLink ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Kutsu luotu. Lähetä tämä linkki osoitteeseen <b>{inviteEmail}</b>. Linkki on voimassa 14 päivää.
              </p>
              <div className="flex items-center space-x-2">
                <input readOnly value={createdLink} className="flex-1 bg-slate-900/50 border border-white/10 rounded-xl py-2 px-3 text-xs" onFocus={(e) => e.target.select()} />
                <button type="button" onClick={() => copy(createdLink)} className="premium-button premium-gradient text-white text-sm">Kopioi</button>
              </div>
              <button type="button" onClick={() => setInviteOpen(false)} className="w-full py-2 rounded-xl border border-white/10 text-slate-300">Valmis</button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
              <label className="block space-y-1">
                <span className="text-sm text-slate-400">Sähköposti</span>
                <input type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full bg-slate-900/50 border border-white/10 rounded-xl py-2 px-3" placeholder="nimi@esimerkki.fi" />
              </label>
              <AccessEditor value={inviteAccess} onChange={setInviteAccess} allowOwner={false} />
              {error && <div className="text-sm text-red-400">{error}</div>}
              <button type="submit" disabled={invite.isPending} className="w-full premium-button premium-gradient text-white">
                {invite.isPending ? 'Luodaan…' : 'Luo kutsulinkki'}
              </button>
            </form>
          )}
        </Modal>
      )}

      {editing && (
        <Modal title={`Oikeudet: ${editing.email}`} onClose={() => setEditing(null)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <AccessEditor value={editing.access} onChange={(access) => setEditing({ ...editing, access })} allowOwner={orgRole === 'OWNER'} />
            {error && <div className="text-sm text-red-400">{error}</div>}
            <button type="submit" disabled={save.isPending} className="w-full premium-button premium-gradient text-white">
              {save.isPending ? 'Tallennetaan…' : 'Tallenna'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
};

export default UsersPage;
