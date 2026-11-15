import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, Search, X } from 'lucide-react';
import { createAccount, getAccounts, updateAccount } from '../api/accounting';
import type { Account } from '../api/accounting';
import { useCompany } from '../hooks/useCompany';

const errorText = (err: any) => err?.response?.data?.error || 'Toiminto epäonnistui';

type Ranges = [number, number][];
const inRanges = (n: number, ranges: Ranges) => ranges.some(([lo, hi]) => n >= lo && n <= hi);

/** Tilikartan pääryhmät samoilla numeroalueilla kuin raporttipalvelun kaavat (reporting-service/src/reports.py). */
const MAIN_GROUPS: { title: string; ranges: Ranges; report: string }[] = [
  { title: 'Vastaavaa', ranges: [[1000, 1999]], report: 'Tase' },
  { title: 'Oma pääoma', ranges: [[2000, 2399]], report: 'Tase' },
  { title: 'Vieras pääoma', ranges: [[2400, 2999]], report: 'Tase' },
  { title: 'Hoitotuotot', ranges: [[3000, 3899]], report: 'Tuloslaskelma' },
  { title: 'Pääomavastikkeet ja rahoitustuotot', ranges: [[3900, 3999]], report: 'Tuloslaskelma' },
  { title: 'Hoitokulut', ranges: [[4000, 6899], [7000, 7999]], report: 'Tuloslaskelma' },
  { title: 'Poistot', ranges: [[6900, 6999]], report: 'Tuloslaskelma' },
  { title: 'Rahoituskulut', ranges: [[8000, 8999]], report: 'Tuloslaskelma' },
  { title: 'Tuloverot', ranges: [[9000, 9999]], report: 'Tuloslaskelma' },
];

/** Tuloslaskelman erittelyrivit (taloyhtiön kaava) ja taseen alaryhmät. */
const FORMULA_LINES: { title: string; ranges: Ranges }[] = [
  { title: 'Aineelliset hyödykkeet', ranges: [[1000, 1099]] },
  { title: 'Sijoitukset', ranges: [[1100, 1499]] },
  { title: 'Saamiset', ranges: [[1500, 1899], [1990, 1999]] },
  { title: 'Rahat ja pankkisaamiset', ranges: [[1900, 1989]] },
  { title: 'Pitkäaikainen vieras pääoma', ranges: [[2400, 2699]] },
  { title: 'Lyhytaikainen vieras pääoma', ranges: [[2700, 2999]] },
  { title: 'Vastikkeet', ranges: [[3000, 3099]] },
  { title: 'Käyttökorvaukset', ranges: [[3100, 3499]] },
  { title: 'Vuokratuotot', ranges: [[3500, 3599]] },
  { title: 'Muut hoitotuotot', ranges: [[3600, 3899]] },
  { title: 'Henkilöstökulut', ranges: [[4010, 4029]] },
  { title: 'Hallinto', ranges: [[4000, 4009], [4030, 4099], [4900, 4999]] },
  { title: 'Käyttö ja huolto', ranges: [[4100, 4199]] },
  { title: 'Ulkoalueiden hoito', ranges: [[4200, 4249]] },
  { title: 'Siivous', ranges: [[4250, 4299]] },
  { title: 'Jätehuolto', ranges: [[4300, 4499]] },
  { title: 'Lämmitys', ranges: [[4500, 4599]] },
  { title: 'Vesi ja jätevesi', ranges: [[4600, 4699]] },
  { title: 'Sähkö ja kaasu', ranges: [[4700, 4799]] },
  { title: 'Vahinkovakuutukset', ranges: [[4800, 4849]] },
  { title: 'Vuokrat', ranges: [[4850, 4869]] },
  { title: 'Kiinteistövero', ranges: [[4870, 4899]] },
  { title: 'Korjaukset', ranges: [[7000, 7899]] },
  { title: 'Muut hoitokulut', ranges: [[5000, 6899], [7900, 7999]] },
];

const numberOf = (accountNumber: string) => (/^\d{4,6}$/.test(accountNumber) ? Number(accountNumber.slice(0, 4)) : NaN);

/** Mihin raportin kohtaan tili osuu, esim. "Tuloslaskelma › Hoitokulut › Lämmitys". */
const placementOf = (accountNumber: string): string | null => {
  const n = numberOf(accountNumber);
  if (Number.isNaN(n)) return null;
  const main = MAIN_GROUPS.find((g) => inRanges(n, g.ranges));
  if (!main) return null;
  const line = FORMULA_LINES.find((l) => inRanges(n, l.ranges));
  return [main.report, main.title, line && line.title !== main.title ? line.title : null].filter(Boolean).join(' › ');
};

const AccountRow = ({ account, canManage }: { account: Account; canManage: boolean }) => {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.accountName);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: { accountName?: string; isActive?: boolean }) => updateAccount(account.id, body),
    onSuccess: () => { setEditing(false); setError(null); queryClient.invalidateQueries({ queryKey: ['accounts'] }); },
    onError: (err) => setError(errorText(err)),
  });
  const line = FORMULA_LINES.find((l) => inRanges(numberOf(account.accountNumber), l.ranges));

  return (
    <tr className={`border-b border-white/5 ${account.isActive ? '' : 'opacity-50'}`}>
      <td className="py-2 pr-4 font-mono">{account.accountNumber}</td>
      <td className="py-2 pr-4">
        {editing ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => { e.preventDefault(); save.mutate({ accountName: name }); }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-2 py-1"
            />
            <button type="submit" title="Tallenna" className="text-emerald-400"><Check className="w-4 h-4" /></button>
            <button type="button" title="Peru" onClick={() => { setEditing(false); setName(account.accountName); }} className="text-slate-400">
              <X className="w-4 h-4" />
            </button>
          </form>
        ) : (
          <span>
            {account.accountName}
            {!account.isActive && <span className="ml-2 text-xs text-slate-500">(ei käytössä)</span>}
          </span>
        )}
        {error && <div className="text-xs text-rose-300 mt-1">{error}</div>}
      </td>
      <td className="py-2 pr-4 text-slate-500 text-xs">{line?.title ?? ''}</td>
      {canManage && (
        <td className="py-2 text-right whitespace-nowrap">
          {!editing && (
            <button type="button" onClick={() => setEditing(true)} title="Nimeä uudelleen" className="text-slate-400 hover:text-white mr-3">
              <Pencil className="w-4 h-4 inline" />
            </button>
          )}
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate({ isActive: !account.isActive })}
            className="text-xs text-slate-400 hover:text-white"
          >
            {account.isActive ? 'Poista käytöstä' : 'Ota käyttöön'}
          </button>
        </td>
      )}
    </tr>
  );
};

const AccountsPage = () => {
  const { selectedCompany, canManage } = useCompany();
  const companyId = selectedCompany?.id;
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const { data: accounts, isLoading, error } = useQuery({
    queryKey: ['accounts', companyId],
    queryFn: () => getAccounts(companyId as string) as Promise<Account[]>,
    enabled: !!companyId,
  });

  const create = useMutation({
    mutationFn: () => createAccount({ companyId: companyId as string, accountNumber: number.trim(), accountName: name.trim() }),
    onSuccess: () => {
      setNumber(''); setName(''); setFormError(null);
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err) => setFormError(errorText(err)),
  });

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const visible = (accounts ?? [])
      .filter((a) => showInactive || a.isActive)
      .filter((a) => !q || `${a.accountNumber} ${a.accountName}`.toLowerCase().includes(q));
    return MAIN_GROUPS
      .map((g) => ({ ...g, accounts: visible.filter((a) => inRanges(numberOf(a.accountNumber), g.ranges)) }))
      .filter((g) => g.accounts.length);
  }, [accounts, filter, showInactive]);

  const inactiveCount = (accounts ?? []).filter((a) => !a.isActive).length;
  const placement = number.trim() ? placementOf(number.trim()) : null;

  if (!companyId) return <div className="glass-card p-8 text-center text-slate-400">Valitse ensin yhtiö.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Tilikartta</h2>
        <p className="text-slate-400 mt-1">
          {selectedCompany?.name}: taloyhtiön tilikartta. Tilin numero määrää, mihin kohtaan tuloslaskelmaa tai tasetta se kuuluu.
        </p>
      </div>

      {canManage ? (
        <form
          className="glass-card p-5 space-y-3"
          onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
        >
          <h3 className="font-semibold">Lisää tili</h3>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Numero, esim. 4510"
              inputMode="numeric"
              className="sm:w-48 bg-slate-900/50 border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nimi, esim. Kaukolämpö"
              className="flex-1 bg-slate-900/50 border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={!placement || !name.trim() || create.isPending}
              className="premium-button premium-gradient text-white disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />Lisää
            </button>
          </div>
          <div className="text-xs text-slate-400">
            {number.trim() === ''
              ? 'Numero on 4–6 numeroa. Neljä ensimmäistä määräävät paikan raportilla.'
              : placement
                ? <>Näkyy: <span className="text-slate-200">{placement}</span></>
                : <span className="text-rose-300">Numero on 4–6 numeroa väliltä 1000–9999.</span>}
          </div>
          {formError && <div className="text-sm text-rose-300">{formError}</div>}
        </form>
      ) : (
        <div className="text-sm text-slate-400">Tilikarttaa voi muokata vain yhtiön isännöitsijä.</div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Etsi tiliä numerolla tai nimellä"
            className="w-full bg-slate-900/50 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 focus:outline-none focus:border-primary-500 text-sm"
          />
        </div>
        {inactiveCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            <span>Näytä käytöstä poistetut ({inactiveCount})</span>
          </label>
        )}
      </div>

      {error && <div className="text-sm text-rose-300">Tilikarttaa ei saatu haettua.</div>}
      {isLoading ? (
        <div className="glass-card h-64 animate-pulse" />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {groups.map((g) => (
            <div key={g.title} className="glass-card p-5 overflow-x-auto">
              <h3 className="font-semibold mb-2">
                {g.title} <span className="text-xs text-slate-500 font-normal">{g.report}</span>
              </h3>
              <table className="w-full text-sm">
                <tbody>
                  {g.accounts.map((a) => <AccountRow key={a.id} account={a} canManage={canManage} />)}
                </tbody>
              </table>
            </div>
          ))}
          {groups.length === 0 && <div className="text-slate-400">Ei hakua vastaavia tilejä.</div>}
        </div>
      )}
    </div>
  );
};

export default AccountsPage;
