import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { AlertCircle, Building2, CheckCircle2, Search } from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import type { Company } from '../hooks/useCompany';
import { getOverview } from '../api/accounting';
import type { CompanyOverview } from '../api/accounting';
import { COMPANY_ROLE_LABELS } from '../api/organizations';

const DAY = 86_400_000;
const STALE_BANK_DAYS = 10; // tiliote yli 10 päivää vanha => muistutus

const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('fi-FI') : '–');

/** Mitä yhtiössä on tehtävää, tärkein ensin. Pisteet järjestävät listan. */
const attentionOf = (o: CompanyOverview | undefined) => {
  if (!o) return { score: 0, items: [] as string[] };
  const items: string[] = [];
  let score = 0;
  if (o.closingDue) { items.push('Tilinpäätös tekemättä'); score += 50; }
  if (o.overdueInvoices) { items.push(`${o.overdueInvoices} erääntynyttä ostolaskua`); score += 30 + o.overdueInvoices; }
  if (o.needsVoucher) { items.push(`${o.needsVoucher} tositetta puuttuu`); score += 10 + o.needsVoucher; }
  const manual = o.pending - o.autoApprovable;
  if (manual > 0) { items.push(`${manual} käsiteltävää`); score += manual; }
  if (o.autoApprovable) { items.push(`${o.autoApprovable} varmaa hyväksyttäväksi`); score += 1; }
  const bankAge = o.lastBankDate ? (Date.now() - new Date(o.lastBankDate).getTime()) / DAY : Infinity;
  if (bankAge > STALE_BANK_DAYS) { items.push(o.lastBankDate ? 'Tiliote yli 10 pv vanha' : 'Ei tiliotteita'); score += 5; }
  return { score, items };
};

const OverviewPage = () => {
  const navigate = useNavigate();
  const { companies, isLoading, selectCompany, organization, isOrgAdmin } = useCompany();
  const [filter, setFilter] = useState('');
  const [onlyAttention, setOnlyAttention] = useState(false);

  const ids = useMemo(() => (companies ?? []).map((c) => c.id), [companies]);
  const { data: overview, isLoading: overviewLoading, error } = useQuery({
    queryKey: ['overview', ids],
    queryFn: () => getOverview(ids),
    enabled: ids.length > 0,
    refetchInterval: 60_000,
  });

  const rows = useMemo(() => {
    const byId = new Map((overview ?? []).map((o) => [o.companyId, o]));
    return (companies ?? [])
      .map((c) => ({ company: c, data: byId.get(c.id), ...attentionOf(byId.get(c.id)) }))
      .filter((r) => !filter || `${r.company.name} ${r.company.businessId}`.toLowerCase().includes(filter.toLowerCase()))
      .filter((r) => !onlyAttention || r.items.length > 0)
      .sort((a, b) => b.score - a.score || a.company.name.localeCompare(b.company.name, 'fi'));
  }, [companies, overview, filter, onlyAttention]);

  const totals = useMemo(() => {
    const list = overview ?? [];
    return {
      pending: list.reduce((s, o) => s + o.pending, 0),
      needsVoucher: list.reduce((s, o) => s + o.needsVoucher, 0),
      overdue: list.reduce((s, o) => s + o.overdueInvoices, 0),
      closing: list.filter((o) => o.closingDue).length,
    };
  }, [overview]);

  const open = (company: Company, path: string) => {
    selectCompany(company.id);
    navigate(path);
  };

  if (isLoading) return <div className="glass-card h-64 animate-pulse" />;

  if (!companies?.length) {
    return (
      <div className="glass-card p-12 text-center">
        <Building2 className="w-10 h-10 text-slate-600 mx-auto mb-4" />
        <h3 className="text-xl font-bold">Ei yhtiöitä</h3>
        <p className="text-slate-400 mt-2">
          {isOrgAdmin
            ? 'Lisää toimiston ensimmäinen taloyhtiö.'
            : 'Sinulle ei ole vielä annettu oikeuksia yhteenkään yhtiöön. Pyydä isännöitsijää lisäämään sinut.'}
        </p>
        {isOrgAdmin && (
          <Link to="/companies" className="inline-block mt-6 premium-button premium-gradient text-white">Lisää yhtiö</Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
       <div>
        <h2 className="text-2xl font-bold">Kaikki yhtiöt</h2>
        <p className="text-slate-400 mt-1">
          {organization?.name ? `${organization.name}: ` : ''}{companies.length} yhtiötä. Eniten huomiota vaativat ensin.
        </p>
       </div>
       {companies.some((c) => c.myRole === 'MANAGER' || c.myRole === 'ASSISTANT') && (
         <Link to="/queue" className="premium-button premium-gradient text-white whitespace-nowrap">Avaa työjono</Link>
       )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Käsittelemättömät', value: totals.pending },
          { label: 'Puuttuvat tositteet', value: totals.needsVoucher },
          { label: 'Erääntyneet ostolaskut', value: totals.overdue },
          { label: 'Tilinpäätöksiä tekemättä', value: totals.closing },
        ].map((t) => (
          <div key={t.label} className="glass-card p-5">
            <div className="text-sm text-slate-400">{t.label}</div>
            <div className="text-3xl font-bold mt-1">{overviewLoading ? '…' : t.value}</div>
          </div>
        ))}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          Yhtiöiden tilannetta ei saatu haettua kirjanpitopalvelusta. Yhtiölista näkyy silti.
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Etsi yhtiötä tai Y-tunnusta"
            className="w-full bg-slate-900/50 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 focus:outline-none focus:border-primary-500 text-sm"
          />
        </div>
        <label className="flex items-center space-x-2 text-sm text-slate-300">
          <input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} />
          <span>Näytä vain yhtiöt, joissa on tehtävää</span>
        </label>
      </div>

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-white/5">
              <th className="p-4 font-medium">Yhtiö</th>
              <th className="p-4 font-medium">Tehtävää</th>
              <th className="p-4 font-medium">Viimeisin pankkitapahtuma</th>
              <th className="p-4 font-medium">Avoin tilikausi</th>
              <th className="p-4 font-medium">Roolisi</th>
              <th className="p-4" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ company, data, items }) => (
              <tr key={company.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="p-4">
                  <button type="button" onClick={() => open(company, '/company')} className="font-semibold hover:text-primary-400 text-left">
                    {company.name}
                  </button>
                  <div className="text-xs text-slate-500">{company.businessId}{company.companyType === 'KOY' ? ' · KOY' : ''}</div>
                </td>
                <td className="p-4">
                  {!data ? (
                    <span className="text-slate-500">{overviewLoading ? '…' : '–'}</span>
                  ) : items.length === 0 ? (
                    <span className="inline-flex items-center text-emerald-400"><CheckCircle2 className="w-4 h-4 mr-1" />Ajan tasalla</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {items.map((i) => (
                        <li key={i} className="flex items-center text-amber-300"><AlertCircle className="w-3.5 h-3.5 mr-1.5 shrink-0" />{i}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="p-4 text-slate-300">{fmtDate(data?.lastBankDate)}</td>
                <td className="p-4 text-slate-300">
                  {data?.openFiscalYear ? `${fmtDate(data.openFiscalYear.startDate)}–${fmtDate(data.openFiscalYear.endDate)}` : '–'}
                </td>
                <td className="p-4 text-slate-400">{COMPANY_ROLE_LABELS[company.myRole] ?? company.myRole}</td>
                <td className="p-4 text-right whitespace-nowrap">
                  {data && data.pending > 0 && (company.myRole === 'MANAGER' || company.myRole === 'ASSISTANT') && (
                    <button type="button" onClick={() => open(company, '/pending')} className="text-primary-400 hover:text-primary-300 font-semibold mr-4">
                      Käsittele
                    </button>
                  )}
                  <button type="button" onClick={() => open(company, '/company')} className="text-slate-300 hover:text-white">Avaa</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="p-8 text-center text-slate-400">Ei hakua vastaavia yhtiöitä.</div>}
      </div>
    </div>
  );
};

export default OverviewPage;
