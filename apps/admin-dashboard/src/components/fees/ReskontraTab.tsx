import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { addPayment, getReskontra } from '../../api/fees';
import type { LedgerInvoice } from '../../api/fees';
import { ErrorBox, eur, errorText, fmtDate, inputClass, isoDay, periodLabel, smallButton } from './common';

const KIND_LABEL: Record<string, string> = { FEE: 'Vastike', REMINDER: 'Muistutus', OTHER: 'Lasku' };

const statusOf = (i: LedgerInvoice) => {
  if (i.status === 'CANCELLED') return { text: 'Mitätöity', cls: 'text-slate-500' };
  if (i.open <= 0) return { text: 'Maksettu', cls: 'text-emerald-400' };
  if (i.daysOverdue > 0) return { text: `Myöhässä ${i.daysOverdue} pv`, cls: 'text-rose-300' };
  if (i.paidAmount > 0) return { text: 'Osittain maksettu', cls: 'text-amber-300' };
  return { text: 'Avoin', cls: 'text-slate-300' };
};

const PaymentForm = ({ invoice, onDone }: { invoice: LedgerInvoice; onDone: () => void }) => {
  const [amount, setAmount] = useState(String(invoice.open).replace('.', ','));
  const [paidOn, setPaidOn] = useState(isoDay(new Date()));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => addPayment(invoice.id, { amount: Number(amount.replace(',', '.')), paidOn, note: note || undefined }),
    onSuccess: onDone,
    onError: (err) => setError(errorText(err)),
  });
  return (
    <form className="flex flex-wrap items-center gap-2 mt-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <input className={`${inputClass} w-28`} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Summa" />
      <input className={inputClass} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} aria-label="Maksupäivä" />
      <input className={`${inputClass} flex-1 min-w-40`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Selite, esim. maksettu ilman viitettä" />
      <button type="submit" className={smallButton} disabled={save.isPending}>Kirjaa suoritus</button>
      {error && <span className="text-sm text-rose-300">{error}</span>}
    </form>
  );
};

const InvoiceRow = ({ invoice, canWrite, onChanged }: { invoice: LedgerInvoice; canWrite: boolean; onChanged: () => void }) => {
  const [paying, setPaying] = useState(false);
  const status = statusOf(invoice);
  return (
    <tr className="border-b border-white/5 align-top">
      <td className="py-2 pr-3">
        <div>{KIND_LABEL[invoice.kind] ?? invoice.kind} {periodLabel(invoice.period)}</div>
        <div className="text-xs text-slate-500">Nro {invoice.invoiceNumber} · viite {invoice.referenceNumber}</div>
      </td>
      <td className="py-2 pr-3 text-slate-400">{fmtDate(invoice.dueDate)}</td>
      <td className="py-2 pr-3 text-right font-mono">{eur(invoice.totalAmount)}</td>
      <td className="py-2 pr-3 text-right font-mono">{eur(invoice.paidAmount)}</td>
      <td className="py-2 pr-3">
        <span className={status.cls}>{status.text}</span>
        {invoice.lastReminderAt && <div className="text-xs text-slate-500">Muistutettu {fmtDate(invoice.lastReminderAt)}</div>}
        {invoice.payments.map((p) => (
          <div key={p.id} className="text-xs text-slate-500">
            {fmtDate(p.paidOn)} {eur(p.amount)} {p.source === 'BANK' ? 'pankista' : 'käsin'}{p.note ? `, ${p.note}` : ''}
          </div>
        ))}
        {paying && <PaymentForm invoice={invoice} onDone={() => { setPaying(false); onChanged(); }} />}
      </td>
      <td className="py-2 text-right">
        {canWrite && invoice.open > 0 && invoice.status !== 'CANCELLED' && !paying && (
          <button type="button" className="text-xs text-primary-400 hover:text-primary-300" onClick={() => setPaying(true)}>Kirjaa suoritus</button>
        )}
      </td>
    </tr>
  );
};

const ReskontraTab = ({ companyId, canWrite }: { companyId: string; canWrite: boolean }) => {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['reskontra', companyId], queryFn: () => getReskontra(companyId) });

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data?.balances ?? [])
      .filter((b) => !q || `${b.apartment} ${b.recipientName}`.toLowerCase().includes(q))
      .filter((b) => !onlyOpen || b.open > 0);
  }, [data, filter, onlyOpen]);
  const totals = useMemo(() => (data?.balances ?? []).reduce(
    (t, b) => ({ billed: t.billed + b.billed, paid: t.paid + b.paid, open: t.open + b.open, overdue: t.overdue + b.overdue }),
    { billed: 0, paid: 0, open: 0, overdue: 0 },
  ), [data]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['reskontra', companyId] });

  if (isLoading) return <div className="glass-card h-64 animate-pulse" />;
  if (error) return <ErrorBox text="Reskontraa ei saatu haettua laskutuspalvelusta." />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[['Laskutettu', totals.billed], ['Maksettu', totals.paid], ['Avoinna', totals.open], ['Erääntynyt', totals.overdue]].map(([label, value]) => (
          <div key={label as string} className="glass-card p-4">
            <div className="text-sm text-slate-400">{label}</div>
            <div className={`text-2xl font-bold mt-1 ${label === 'Erääntynyt' && (value as number) > 0 ? 'text-rose-300' : ''}`}>{eur(value as number)}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Etsi huoneistoa tai osakasta"
            className="w-full bg-slate-900/50 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-primary-500" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          <span>Vain avoimet</span>
        </label>
      </div>
      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-white/5">
              <th className="p-3 font-medium">Huoneisto</th>
              <th className="p-3 font-medium">Osakas</th>
              <th className="p-3 font-medium text-right">Laskutettu</th>
              <th className="p-3 font-medium text-right">Maksettu</th>
              <th className="p-3 font-medium text-right">Avoinna</th>
              <th className="p-3 font-medium">Erääntynyt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const open = expanded === b.apartment;
              const invoices = (data?.invoices ?? []).filter((i) => (i.apartment ?? `(${i.recipientName})`) === b.apartment);
              return [
                <tr key={b.apartment} className="border-b border-white/5 hover:bg-white/[0.02] cursor-pointer" onClick={() => setExpanded(open ? null : b.apartment)}>
                  <td className="p-3 font-semibold whitespace-nowrap">
                    {open ? <ChevronDown className="w-4 h-4 inline mr-1" /> : <ChevronRight className="w-4 h-4 inline mr-1" />}{b.apartment}
                  </td>
                  <td className="p-3">{b.recipientName}</td>
                  <td className="p-3 text-right font-mono">{eur(b.billed)}</td>
                  <td className="p-3 text-right font-mono">{eur(b.paid)}</td>
                  <td className={`p-3 text-right font-mono ${b.open > 0 ? 'font-semibold' : 'text-slate-500'}`}>{eur(b.open)}</td>
                  <td className="p-3">
                    {b.overdue > 0
                      ? <span className="text-rose-300">{eur(b.overdue)} <span className="text-xs text-slate-500">eräpv {fmtDate(b.oldestDueDate)} alkaen</span></span>
                      : <span className="text-slate-500">–</span>}
                  </td>
                </tr>,
                open && (
                  <tr key={`${b.apartment}-detail`} className="bg-slate-900/40">
                    <td colSpan={6} className="px-6 py-3">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-slate-500">
                            <th className="pb-1 pr-3">Lasku</th><th className="pb-1 pr-3">Eräpäivä</th><th className="pb-1 pr-3 text-right">Summa</th>
                            <th className="pb-1 pr-3 text-right">Maksettu</th><th className="pb-1 pr-3">Tila ja suoritukset</th><th />
                          </tr>
                        </thead>
                        <tbody>
                          {invoices.map((i) => <InvoiceRow key={i.id} invoice={i} canWrite={canWrite} onChanged={refresh} />)}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-8 text-center text-slate-400">
            {data?.balances.length ? 'Ei hakua vastaavia huoneistoja.' : 'Ei vielä laskuja. Tee ensimmäinen laskutusajo Laskutusajo-välilehdellä.'}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReskontraTab;
