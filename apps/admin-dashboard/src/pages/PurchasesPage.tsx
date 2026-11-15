import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Download, X } from 'lucide-react';
import {
  createPaymentBatch, decidePurchase, downloadPaymentBatch, getPaymentBatches, getPurchases, updatePaymentBatch,
  updatePurchaseDetails, updatePurchasePolicy, withdrawPurchaseDecision,
} from '../api/accounting';
import type { Purchase, PurchasePolicy } from '../api/accounting';
import { useCompany } from '../hooks/useCompany';
import { ErrorBox, InfoBox, eur, errorText, fmtDate, inputClass, isoDay, smallButton } from '../components/fees/common';

const ROLE_LABEL: Record<string, string> = { MANAGER: 'isännöitsijä', BOARD: 'hallitus', ASSISTANT: 'assistentti' };
const TABS = [
  { key: 'approve', label: 'Hyväksyttävät' },
  { key: 'pay', label: 'Maksettavat' },
  { key: 'batches', label: 'Maksuerät' },
  { key: 'all', label: 'Kaikki' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const nextBankDay = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return isoDay(d);
};

const dueClass = (due: string | null) => {
  if (!due) return 'text-slate-500';
  const days = (new Date(due).getTime() - Date.now()) / 86_400_000;
  return days < 0 ? 'text-rose-300' : days < 7 ? 'text-amber-300' : 'text-slate-300';
};

/** Saajan tili ja viite: muokattavissa ennen maksua (tekoäly voi lukea ne väärin). */
const PaymentDetails = ({ p, canWrite, onSaved }: { p: Purchase; canWrite: boolean; onSaved: () => void }) => {
  const [editing, setEditing] = useState(false);
  const [iban, setIban] = useState(p.iban ?? '');
  const [ref, setRef] = useState(p.referenceNumber ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => updatePurchaseDetails(p.id, { iban, referenceNumber: ref }),
    onSuccess: () => { setEditing(false); setError(null); onSaved(); },
    onError: (err) => setError(errorText(err)),
  });
  if (!editing) {
    return (
      <div className="text-xs text-slate-500">
        {p.iban ?? <span className="text-amber-300">IBAN puuttuu</span>} · viite {p.referenceNumber ?? '–'}
        {canWrite && !p.paymentBatch && p.status !== 'PAID' && (
          <button type="button" className="ml-2 text-primary-400 hover:text-primary-300" onClick={() => setEditing(true)}>Korjaa</button>
        )}
      </div>
    );
  }
  return (
    <form className="flex flex-wrap gap-2 mt-1" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <input className={`${inputClass} w-56`} value={iban} onChange={(e) => setIban(e.target.value)} placeholder="IBAN" />
      <input className={`${inputClass} w-40`} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Viite" />
      <button type="submit" className={smallButton}>Tallenna</button>
      <button type="button" className={smallButton} onClick={() => setEditing(false)}>Peru</button>
      {error && <div className="text-xs text-rose-300 w-full">{error}</div>}
      <div className="text-xs text-slate-500 w-full">Tilinumeron muutos vaatii laskun hyväksynnän uudelleen.</div>
    </form>
  );
};

const ApprovalCell = ({ p, canApprove, onChanged }: { p: Purchase; canApprove: boolean; onChanged: () => void }) => {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (v: { decision: 'APPROVE' | 'REJECT'; comment?: string }) => decidePurchase(p.id, v.decision, v.comment),
    onSuccess: () => { setRejecting(false); setError(null); onChanged(); },
    onError: (err) => setError(errorText(err)),
  });
  const withdraw = useMutation({ mutationFn: () => withdrawPurchaseDecision(p.id), onSuccess: onChanged, onError: (e) => setError(errorText(e)) });

  return (
    <div className="space-y-1">
      {p.approvals.map((a) => (
        <div key={a.userId + a.createdAt} className={`text-xs ${a.decision === 'APPROVE' ? 'text-emerald-400' : 'text-rose-300'}`}>
          {a.decision === 'APPROVE' ? 'Hyväksynyt' : 'Hylännyt'} {ROLE_LABEL[a.role] ?? a.role} {fmtDate(a.createdAt)}{a.comment ? `: ${a.comment}` : ''}
        </div>
      ))}
      {p.waitingFor && p.approvalStatus === 'PENDING' && <div className="text-xs text-slate-400">Odottaa: {p.waitingFor}</div>}
      {canApprove && !p.paymentBatch && p.status !== 'PAID' && (
        p.myDecision ? (
          <button type="button" className="text-xs text-slate-400 hover:text-white" onClick={() => withdraw.mutate()}>Peru oma päätös</button>
        ) : rejecting ? (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); decide.mutate({ decision: 'REJECT', comment: reason }); }}>
            <input autoFocus className={`${inputClass} flex-1`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Hylkäyksen syy" />
            <button type="submit" className={smallButton}>Hylkää</button>
            <button type="button" className={smallButton} onClick={() => setRejecting(false)}>Peru</button>
          </form>
        ) : (
          <div className="flex gap-2">
            <button type="button" className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-sm flex items-center gap-1"
              disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'APPROVE' })}>
              <Check className="w-4 h-4" />Hyväksy
            </button>
            <button type="button" className="px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-1"
              onClick={() => setRejecting(true)}>
              <X className="w-4 h-4" />Hylkää
            </button>
          </div>
        )
      )}
      {error && <div className="text-xs text-rose-300">{error}</div>}
    </div>
  );
};

const PurchaseTable = ({ rows, children }: { rows: Purchase[]; children: (p: Purchase) => ReactNode }) => (
  <div className="glass-card overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-slate-400 border-b border-white/5">
          <th className="p-3 font-medium">Toimittaja ja lasku</th>
          <th className="p-3 font-medium">Eräpäivä</th>
          <th className="p-3 font-medium text-right">Summa</th>
          <th className="p-3 font-medium">Tila</th>
        </tr>
      </thead>
      <tbody>{rows.map((p) => children(p))}</tbody>
    </table>
    {rows.length === 0 && <div className="p-8 text-center text-slate-400">Ei laskuja.</div>}
  </div>
);

const PolicyCard = ({ companyId, policy, canManage, onSaved }: { companyId: string; policy: PurchasePolicy; canManage: boolean; onSaved: () => void }) => {
  const [limit, setLimit] = useState(policy.boardLimit === null ? '' : String(policy.boardLimit));
  const [iban, setIban] = useState(policy.debtorIban ?? '');
  const [bic, setBic] = useState(policy.debtorBic ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => updatePurchasePolicy({ companyId, boardLimit: limit.trim() === '' ? null : Number(limit.replace(',', '.')), debtorIban: iban || null, debtorBic: bic || null }),
    onSuccess: () => { setError(null); setMsg('Tallennettu'); onSaved(); },
    onError: (err) => setError(errorText(err)),
  });
  return (
    <div className="glass-card p-5 space-y-3">
      <h3 className="font-semibold">Hyväksyntä ja maksutili</h3>
      <div className="flex flex-wrap gap-4 items-end">
        <label className="text-sm space-y-1">
          <div className="text-slate-400">Hallituksen hyväksyntä, kun summa ylittää (€)</div>
          <input className={`${inputClass} w-40`} disabled={!canManage} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Ei rajaa" />
        </label>
        <label className="text-sm space-y-1">
          <div className="text-slate-400">Yhtiön maksutili (IBAN)</div>
          <input className={`${inputClass} w-64`} disabled={!canManage} value={iban} onChange={(e) => setIban(e.target.value)} />
        </label>
        <label className="text-sm space-y-1">
          <div className="text-slate-400">BIC (valinnainen)</div>
          <input className={`${inputClass} w-32`} disabled={!canManage} value={bic} onChange={(e) => setBic(e.target.value)} />
        </label>
        {canManage && <button type="button" className={smallButton} onClick={() => save.mutate()} disabled={save.isPending}>Tallenna</button>}
        {msg && <span className="text-sm text-emerald-400">{msg}</span>}
      </div>
      <p className="text-xs text-slate-500">
        Ilman rajaa riittää isännöitsijän tai hallituksen jäsenen hyväksyntä. Rajan ylittävät laskut vaativat molemmat.
        Assistentti voi valmistella ja korjata maksutietoja, mutta ei hyväksyä.
      </p>
      <ErrorBox text={error} />
    </div>
  );
};

const PayTab = ({ companyId, companyName, rows, policy, canWrite, onDone }: {
  companyId: string; companyName: string; rows: Purchase[]; policy: PurchasePolicy; canWrite: boolean; onDone: () => void;
}) => {
  const payable = rows.filter((p) => !p.paymentBlocker);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(payable.map((p) => p.id)));
  const [date, setDate] = useState(nextBankDay());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = payable.filter((p) => selected.has(p.id)).reduce((s, p) => s + Math.round(p.totalAmount * 100), 0) / 100;
  const create = useMutation({
    mutationFn: () => createPaymentBatch({ companyId, invoiceIds: [...selected], executionDate: date, debtorName: companyName }),
    onSuccess: async (batch) => {
      setError(null);
      setMessage(`Maksuaineisto luotu: ${batch.count} maksua, ${eur(batch.totalAmount)}. Lataa tiedosto ja lähetä se verkkopankissa (aineistolähetys).`);
      await downloadPaymentBatch(batch).catch(() => undefined);
      setSelected(new Set());
      onDone();
    },
    onError: (err) => setError(errorText(err)),
  });
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      {!policy.debtorIban && <InfoBox>Aseta yhtiön maksutili (IBAN) ylempänä ennen ensimmäistä maksuaineistoa.</InfoBox>}
      <ErrorBox text={error} />
      {message && <InfoBox>{message}</InfoBox>}
      <PurchaseTable rows={rows}>
        {(p) => (
          <tr key={p.id} className="border-b border-white/5 align-top">
            <td className="p-3">
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1" disabled={!!p.paymentBlocker || !canWrite} checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                <span>
                  <span className="font-semibold">{p.supplierName}</span> <span className="text-slate-500">nro {p.invoiceNumber ?? '–'}</span>
                  <PaymentDetails p={p} canWrite={canWrite} onSaved={onDone} />
                  {p.duplicateOf && <span className="text-xs text-amber-300 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Mahdollinen tuplalasku</span>}
                </span>
              </label>
            </td>
            <td className={`p-3 ${dueClass(p.dueDate)}`}>{fmtDate(p.dueDate)}</td>
            <td className="p-3 text-right font-mono">{eur(p.totalAmount)}</td>
            <td className="p-3 text-xs text-slate-400">{p.paymentBlocker ?? 'Valmis maksuun'}</td>
          </tr>
        )}
      </PurchaseTable>
      {canWrite && payable.length > 0 && (
        <div className="glass-card p-4 flex flex-wrap items-end gap-4">
          <label className="text-sm space-y-1">
            <div className="text-slate-400">Maksupäivä</div>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button type="button" className="premium-button premium-gradient text-white disabled:opacity-50"
            disabled={!selected.size || create.isPending} onClick={() => create.mutate()}>
            Luo maksuaineisto: {selected.size} laskua, {eur(total)}
          </button>
          <p className="text-xs text-slate-500 basis-full">
            Tiedosto on SEPA-maksuaineisto (pain.001), jonka verkkopankki ottaa vastaan. Rahaa ei siirretä ennen kuin
            hyväksyt maksut pankissa. Sama lasku ei voi päätyä kahteen maksuerään.
          </p>
        </div>
      )}
    </div>
  );
};

const BatchesTab = ({ companyId, canWrite }: { companyId: string; canWrite: boolean }) => {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['payment-batches', companyId], queryFn: () => getPaymentBatches(companyId) });
  const [error, setError] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (v: { id: string; status: 'SENT' | 'CANCELLED' }) => updatePaymentBatch(v.id, v.status),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['payment-batches', companyId] });
      queryClient.invalidateQueries({ queryKey: ['purchases', companyId] });
    },
    onError: (err) => setError(errorText(err)),
  });
  if (isLoading) return <div className="glass-card h-40 animate-pulse" />;
  const STATUS: Record<string, string> = { CREATED: 'Luotu, lähettämättä', SENT: 'Lähetetty pankkiin', CANCELLED: 'Peruttu' };
  return (
    <div className="space-y-4">
      <ErrorBox text={error} />
      {(data ?? []).map((b) => (
        <div key={b.id} className={`glass-card p-4 space-y-2 ${b.status === 'CANCELLED' ? 'opacity-50' : ''}`}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="font-semibold">Maksupäivä {fmtDate(b.executionDate)}</div>
            <div className="text-slate-400 text-sm">{b.count} maksua · {eur(b.totalAmount)} · tililtä {b.debtorIban}</div>
            <div className={`text-xs ${b.status === 'SENT' ? 'text-emerald-400' : 'text-slate-400'}`}>{STATUS[b.status]}</div>
            <div className="ml-auto flex gap-2">
              {canWrite && b.status !== 'CANCELLED' && (
                <button type="button" className={`${smallButton} flex items-center gap-1`} onClick={() => downloadPaymentBatch(b)}>
                  <Download className="w-4 h-4" />Lataa
                </button>
              )}
              {canWrite && b.status === 'CREATED' && (
                <>
                  <button type="button" className={smallButton} onClick={() => update.mutate({ id: b.id, status: 'SENT' })}>Merkitse lähetetyksi</button>
                  <button type="button" className={smallButton} onClick={() => update.mutate({ id: b.id, status: 'CANCELLED' })}>Peru</button>
                </>
              )}
            </div>
          </div>
          <div className="text-xs text-slate-500">
            {b.invoices.map((i) => `${i.supplierName} ${i.invoiceNumber ?? ''} ${eur(i.totalAmount)}${i.status === 'PAID' ? ' (maksettu)' : ''}`).join(' · ')}
          </div>
        </div>
      ))}
      {(data ?? []).length === 0 && <div className="glass-card p-8 text-center text-slate-400">Ei maksueriä.</div>}
    </div>
  );
};

const PurchasesPage = () => {
  const { selectedCompany, canWrite, canManage } = useCompany();
  const companyId = selectedCompany?.id;
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('approve');
  const { data, isLoading, error } = useQuery({ queryKey: ['purchases', companyId], queryFn: () => getPurchases(companyId!), enabled: !!companyId });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['purchases', companyId] });
    queryClient.invalidateQueries({ queryKey: ['payment-batches', companyId] });
  };

  const groups = useMemo(() => {
    const list = data?.invoices ?? [];
    return {
      approve: list.filter((p) => p.status !== 'PAID' && (p.approvalStatus === 'PENDING' || p.approvalStatus === 'REJECTED')),
      pay: list.filter((p) => p.status !== 'PAID' && p.approvalStatus === 'APPROVED' && !p.paymentBatch),
      all: list,
    };
  }, [data]);
  const canApprove = data?.myRole === 'MANAGER' || data?.myRole === 'BOARD';

  if (!companyId) return <div className="glass-card p-8 text-center text-slate-400">Valitse ensin yhtiö.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Ostolaskut</h2>
        <p className="text-slate-400 mt-1">{selectedCompany?.name}: laskujen hyväksyntä ja maksuaineisto pankkiin.</p>
      </div>
      {data && canManage && <PolicyCard key={JSON.stringify(data.policy)} companyId={companyId} policy={data.policy} canManage={canManage} onSaved={refresh} />}
      <div className="flex flex-wrap gap-1 bg-slate-900/50 p-1 rounded-xl border border-white/5 w-fit">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${tab === t.key ? 'bg-primary-500 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}>
            {t.label}{t.key !== 'batches' && data ? ` (${groups[t.key].length})` : ''}
          </button>
        ))}
      </div>
      {error && <ErrorBox text="Ostolaskuja ei saatu haettua." />}
      {isLoading && <div className="glass-card h-64 animate-pulse" />}
      {data && tab === 'approve' && (
        <PurchaseTable rows={groups.approve}>
          {(p) => (
            <tr key={p.id} className="border-b border-white/5 align-top">
              <td className="p-3">
                <div><span className="font-semibold">{p.supplierName}</span> <span className="text-slate-500">nro {p.invoiceNumber ?? '–'} · tili {p.expenseAccount}</span></div>
                <PaymentDetails p={p} canWrite={canWrite} onSaved={refresh} />
                {p.duplicateOf && <div className="text-xs text-amber-300 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Mahdollinen tuplalasku: sama toimittaja ja summa</div>}
              </td>
              <td className={`p-3 ${dueClass(p.dueDate)}`}>{fmtDate(p.dueDate)}</td>
              <td className="p-3 text-right font-mono">{eur(p.totalAmount)}{p.needsBoard && <div className="text-xs text-slate-500">yli hallituksen rajan</div>}</td>
              <td className="p-3"><ApprovalCell p={p} canApprove={canApprove} onChanged={refresh} /></td>
            </tr>
          )}
        </PurchaseTable>
      )}
      {data && tab === 'pay' && (
        <PayTab key={groups.pay.map((p) => p.id).join()} companyId={companyId} companyName={selectedCompany?.name ?? ''} rows={groups.pay}
          policy={data.policy} canWrite={canWrite} onDone={refresh} />
      )}
      {tab === 'batches' && <BatchesTab companyId={companyId} canWrite={canWrite} />}
      {data && tab === 'all' && (
        <PurchaseTable rows={groups.all}>
          {(p) => (
            <tr key={p.id} className="border-b border-white/5 align-top">
              <td className="p-3"><span className="font-semibold">{p.supplierName}</span> <span className="text-slate-500">nro {p.invoiceNumber ?? '–'}</span></td>
              <td className="p-3 text-slate-400">{fmtDate(p.dueDate)}</td>
              <td className="p-3 text-right font-mono">{eur(p.totalAmount)}</td>
              <td className="p-3 text-xs">
                {p.status === 'PAID' ? <span className="text-emerald-400">Maksettu</span>
                  : p.paymentBatch ? `Maksuerässä ${fmtDate(p.paymentBatch.executionDate)}`
                    : p.approvalStatus === 'APPROVED' ? 'Hyväksytty, maksamatta'
                      : p.approvalStatus === 'REJECTED' ? <span className="text-rose-300">Hylätty</span> : 'Odottaa hyväksyntää'}
              </td>
            </tr>
          )}
        </PurchaseTable>
      )}
    </div>
  );
};

export default PurchasesPage;
