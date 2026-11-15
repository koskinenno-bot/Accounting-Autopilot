import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle, CheckCheck, FileText, Link2, Loader2, Save, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useCompany } from '../hooks/useCompany';
import { deleteEntry, getAccounts, getLedgerByStatus, postAutoApprovable, postEntry, updateEntryLines } from '../api/accounting';
import { getInvoices, updateInvoiceStatus } from '../api/invoices';
import { listVouchers, openVoucherFile } from '../api/vouchers';

const SUSPENSE = '1990';
const RECEIVABLES = '1700';
const BANK = '1900';

const eur = (n: number | string) =>
  Number(n).toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

/** Luettava virheilmoitus: backendin { error } tai yleinen viesti. */
const errorText = (err: any) => err?.response?.data?.error || err?.response?.data?.detail || err?.message || 'Tuntematon virhe';

interface Line { accountNumber: string; debit: string; credit: string; description?: string }

const toInputLines = (entry: any): Line[] =>
  entry.lines.map((l: any) => ({
    accountNumber: l.accountNumber,
    debit: String(l.debit),
    credit: String(l.credit),
    description: l.description ?? undefined,
  }));

const EntryCard = ({ entry, accounts, openInvoices, invoicesError, onDone }: {
  entry: any;
  accounts: any[];
  openInvoices: any[];
  invoicesError: string | null;
  onDone: (message: string) => void;
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<Line[]>(() => toInputLines(entry));
  const [showMatch, setShowMatch] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Palvelimen tila voi muuttua (esim. tallennus) => synkronoidaan muokattavat rivit
  useEffect(() => setLines(toInputLines(entry)), [entry]);

  const dirty = lines.some((l, i) => l.accountNumber !== entry.lines[i]?.accountNumber);
  const hasSuspense = lines.some((l) => l.accountNumber === SUSPENSE);
  const amount = entry.lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
  // Saapuva maksu, jonka vastatili on selvitettävät erät => voidaan kohdistaa laskuun
  const isUnmatchedPayment = entry.lines.some((l: any) => l.accountNumber === BANK && Number(l.debit) > 0)
    && entry.lines.some((l: any) => l.accountNumber === SUSPENSE && Number(l.credit) > 0);

  const sortedInvoices = useMemo(
    () => [...openInvoices].sort((a, b) =>
      Math.abs(Number(a.totalAmount) - amount) - Math.abs(Number(b.totalAmount) - amount)),
    [openInvoices, amount],
  );

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['pending'] });
    queryClient.invalidateQueries({ queryKey: ['ledger'] });
    queryClient.invalidateQueries({ queryKey: ['postedLedger'] });
    queryClient.invalidateQueries({ queryKey: ['accStats'] });
    queryClient.invalidateQueries({ queryKey: ['invoices'] });
  };

  const run = useMutation({
    mutationFn: async (action: () => Promise<string>) => action(),
    onMutate: () => setError(null),
    onSuccess: (message) => { refresh(); if (message) onDone(message); },
    onError: (err) => { setError(errorText(err)); refresh(); },
  });

  const save = () => run.mutate(async () => {
    await updateEntryLines(entry.id, lines);
    return '';
  });

  const missingVoucher = entry.needsVoucher && !entry.voucherId;

  const approve = () => {
    if (hasSuspense) { setError(t('pending.suspenseBlock')); return; }
    // KPL 2:5 §: tosite puuttuu => käsittelijä vahvistaa, että tiliote riittää (esim. pankkikulut)
    if (missingVoucher && !window.confirm(t('pending.noVoucherConfirm'))) return;
    run.mutate(async () => {
      if (dirty) await updateEntryLines(entry.id, lines);
      await postEntry(entry.id, missingVoucher);
      return t('pending.approved', { voucher: entry.voucherNumber });
    });
  };

  const showVoucher = () => openVoucherFile(entry.voucherId).catch((err) => setError(errorText(err)));

  const matchInvoice = (invoice: any) => run.mutate(async () => {
    const matched = lines.map((l) =>
      l.accountNumber === SUSPENSE && Number(l.credit) > 0
        ? { ...l, accountNumber: RECEIVABLES, description: `${l.description || ''} / lasku ${invoice.invoiceNumber}`.trim() }
        : l);
    await updateEntryLines(entry.id, matched);
    await postEntry(entry.id);
    // Vienti on jo kirjattu; jos laskun päivitys epäonnistuu, virhe näytetään ja sen voi tehdä Laskutus-sivulla.
    await updateInvoiceStatus(invoice.id, 'PAID');
    return t('pending.matched', { invoice: `${invoice.invoiceNumber} (${invoice.recipientName})` });
  });

  const remove = () => {
    if (!window.confirm(t('pending.deleteConfirm', { voucher: entry.voucherNumber }))) return;
    run.mutate(async () => { await deleteEntry(entry.id); return ''; });
  };

  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm text-slate-400">
            {new Date(entry.entryDate).toLocaleDateString('fi-FI')} · {entry.voucherNumber} · {entry.createdBy}
          </div>
          <div className="font-semibold mt-1">{entry.description}</div>
          <div className="flex flex-wrap gap-2 mt-2">
            {entry.autoApprovable && (
              <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">{t('pending.badgeSure')}</span>
            )}
            {missingVoucher && (
              <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">{t('pending.badgeNoVoucher')}</span>
            )}
          </div>
          {entry.reviewNote && <div className="text-xs text-slate-400 mt-2">{entry.reviewNote}</div>}
        </div>
        <div className="text-right">
          <div className="text-xl font-bold">{eur(amount)}</div>
          {entry.voucherId && (
            <button type="button" onClick={showVoucher} className="mt-2 text-sm text-primary-400 hover:text-primary-300 inline-flex items-center gap-1">
              <FileText className="w-4 h-4" />{t('pending.showVoucher')}
            </button>
          )}
        </div>
      </div>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-slate-400 border-b border-white/5">
            <th className="py-2 font-medium">{t('pending.account')}</th>
            <th className="py-2 font-medium text-right">{t('pending.debit')}</th>
            <th className="py-2 font-medium text-right">{t('pending.credit')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {lines.map((line, i) => (
            <tr key={i}>
              <td className="py-2 pr-4">
                <select
                  value={line.accountNumber}
                  onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, accountNumber: e.target.value } : l)))}
                  className={`w-full max-w-sm bg-slate-900 border rounded-lg px-3 py-2 ${
                    line.accountNumber === SUSPENSE ? 'border-amber-500/50 text-amber-300' : 'border-white/10'
                  }`}
                >
                  {!accounts.some((a) => a.accountNumber === line.accountNumber) && (
                    <option value={line.accountNumber}>{line.accountNumber}</option>
                  )}
                  {accounts.filter((a) => a.isActive !== false || a.accountNumber === line.accountNumber).map((a) => (
                    <option key={a.accountNumber} value={a.accountNumber}>{a.accountNumber} {a.accountName}</option>
                  ))}
                </select>
                {line.description && <div className="text-xs text-slate-500 mt-1">{line.description}</div>}
              </td>
              <td className="py-2 text-right">{Number(line.debit) > 0 ? eur(line.debit) : ''}</td>
              <td className="py-2 text-right">{Number(line.credit) > 0 ? eur(line.credit) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {hasSuspense && (
        <div className="flex items-start gap-2 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t('pending.suspenseBlock')}</span>
        </div>
      )}
      {error && (
        <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">{error}</div>
      )}

      <div className="flex flex-wrap gap-3">
        {isUnmatchedPayment && (
          <button
            type="button"
            onClick={() => setShowMatch(!showMatch)}
            disabled={run.isPending}
            className="premium-button premium-gradient text-white flex items-center space-x-2"
          >
            <Link2 className="w-4 h-4" /><span>{t('pending.matchInvoice')}</span>
          </button>
        )}
        <button
          type="button"
          onClick={approve}
          disabled={run.isPending || hasSuspense}
          title={hasSuspense ? t('pending.suspenseBlock') : undefined}
          className="px-4 py-2 rounded-xl border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold flex items-center space-x-2"
        >
          <CheckCircle className="w-4 h-4" /><span>{t('pending.approve')}</span>
        </button>
        {dirty && (
          <button
            type="button"
            onClick={save}
            disabled={run.isPending}
            className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 text-sm font-semibold flex items-center space-x-2"
          >
            <Save className="w-4 h-4" /><span>{t('pending.save')}</span>
          </button>
        )}
        <button
          type="button"
          onClick={remove}
          disabled={run.isPending}
          className="px-4 py-2 rounded-xl text-slate-400 hover:bg-rose-500/10 hover:text-rose-300 text-sm font-semibold flex items-center space-x-2 ml-auto"
        >
          <Trash2 className="w-4 h-4" /><span>{t('pending.delete')}</span>
        </button>
      </div>

      {showMatch && isUnmatchedPayment && (
        <div className="border-t border-white/5 pt-4 space-y-2">
          <p className="text-sm text-slate-400">{t('pending.matchHint')}</p>
          {invoicesError ? (
            <p className="text-sm text-rose-300">{invoicesError}</p>
          ) : sortedInvoices.length === 0 ? (
            <p className="text-sm text-slate-500 italic">{t('pending.noOpenInvoices')}</p>
          ) : sortedInvoices.map((inv) => {
            const same = Math.abs(Number(inv.totalAmount) - amount) < 0.005;
            return (
              <button
                key={inv.id}
                type="button"
                onClick={() => matchInvoice(inv)}
                disabled={run.isPending}
                className={`w-full flex items-center justify-between rounded-lg px-4 py-3 text-sm border transition-colors hover:bg-white/5 ${
                  same ? 'border-primary-500/40' : 'border-white/10'
                }`}
              >
                <span>
                  {inv.invoiceNumber} · {inv.recipientName} · viite {inv.referenceNumber}
                  {same && <span className="ml-2 text-xs text-primary-300">({t('pending.sameAmount')})</span>}
                </span>
                <span className="font-semibold">{eur(inv.totalAmount)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const PendingEntriesPage = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const { companies, selectedCompany } = useCompany();
  const companyId: string | undefined = selectedCompany?.id;

  const { data: entries, isLoading } = useQuery({
    queryKey: ['pending', companyId],
    queryFn: () => getLedgerByStatus(companyId as string, 'DRAFT'),
    enabled: !!companyId,
  });
  const { data: accounts } = useQuery({
    queryKey: ['accounts', companyId],
    queryFn: () => getAccounts(companyId as string),
    enabled: !!companyId,
  });
  const { data: invoices, error: invoicesLoadError } = useQuery({
    queryKey: ['invoices', companyId],
    queryFn: () => getInvoices(companyId as string),
    enabled: !!companyId,
  });
  // Tositteet, joiden luku on kesken tai epäonnistui (niistä ei vielä ole vientiä)
  const { data: vouchers } = useQuery({
    queryKey: ['vouchers', companyId],
    queryFn: () => listVouchers(companyId as string),
    enabled: !!companyId,
    // päivitetään, kun luku on kesken, jotta valmistuneet luonnokset ilmestyvät
    refetchInterval: (q) => ((q.state.data as any[] | undefined)?.some((v) => ['PENDING', 'PROCESSING'].includes(v.ocrStatus)) ? 3000 : false),
  });
  const processingVouchers = (vouchers || []).filter((v: any) => v.ocrStatus === 'PENDING' || v.ocrStatus === 'PROCESSING');
  const failedVouchers = (vouchers || []).filter((v: any) => v.ocrStatus === 'FAILED');
  const prevProcessing = useRef(0);
  useEffect(() => {
    // luku valmistui => haetaan uudet luonnokset
    if (prevProcessing.current > processingVouchers.length) queryClient.invalidateQueries({ queryKey: ['pending'] });
    prevProcessing.current = processingVouchers.length;
  }, [processingVouchers.length, queryClient]);

  const openInvoices = (invoices || []).filter((i: any) => i.status === 'SENT' || i.status === 'OVERDUE');
  const sorted = [...(entries || [])].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  const sureCount = sorted.filter((e) => e.autoApprovable).length;

  // Työjonosta tultaessa (?entry=<id>) korostetaan ja vieritetään kyseiseen vientiin
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('entry');
  useEffect(() => {
    if (focusId && entries) document.getElementById(`entry-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId, entries]);

  const approveSure = useMutation({
    mutationFn: () => postAutoApprovable(companyId as string),
    onSuccess: (r) => {
      setNotice(t('pending.bulkApproved', { count: r.posted }) + (r.skipped.length ? ` ${t('pending.bulkSkipped', { count: r.skipped.length })}` : ''));
      queryClient.invalidateQueries({ queryKey: ['pending'] });
      queryClient.invalidateQueries({ queryKey: ['accStats'] });
      queryClient.invalidateQueries({ queryKey: ['postedLedger'] });
    },
    onError: (err) => setNotice(errorText(err)),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{t('pending.title')}</h2>
          <p className="text-slate-400 mt-1">{t('pending.subtitle')}</p>
        </div>
        {sureCount > 0 && (
          <button
            type="button"
            onClick={() => approveSure.mutate()}
            disabled={approveSure.isPending}
            className="premium-button premium-gradient text-white flex items-center space-x-2"
          >
            <CheckCheck className="w-4 h-4" /><span>{t('pending.approveAllSure', { count: sureCount })}</span>
          </button>
        )}
      </div>

      {notice && (
        <div className="flex items-center gap-2 text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
          <CheckCircle className="w-4 h-4" /><span>{notice}</span>
        </div>
      )}

      {processingVouchers.length > 0 && (
        <div className="glass-card p-4 flex items-center gap-3 text-sm text-slate-300">
          <Loader2 className="w-4 h-4 animate-spin text-primary-400" />
          <span>{t('pending.processing', { count: processingVouchers.length })}</span>
        </div>
      )}
      {failedVouchers.map((v: any) => (
        <div key={v.id} className="glass-card p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div>
            <div className="font-semibold text-rose-300">{t('pending.readFailed')}: {v.files?.[0]?.filename}</div>
            <div className="text-slate-400 mt-1">{v.ocrData?.error}</div>
          </div>
          <button type="button" onClick={() => openVoucherFile(v.id).catch((err) => setNotice(errorText(err)))} className="text-primary-400 hover:text-primary-300 inline-flex items-center gap-1">
            <FileText className="w-4 h-4" />{t('pending.showVoucher')}
          </button>
        </div>
      ))}

      {isLoading || !companies ? (
        <div className="glass-card p-8 text-center text-slate-400">{t('common.loading')}</div>
      ) : sorted.length === 0 ? (
        <div className="glass-card p-8 text-center text-slate-400">{t('pending.empty')}</div>
      ) : (
        sorted.map((entry) => (
          <div key={entry.id} id={`entry-${entry.id}`} className={entry.id === focusId ? 'ring-2 ring-primary-500 rounded-2xl' : undefined}>
            <EntryCard
              entry={entry}
              accounts={accounts || []}
              openInvoices={openInvoices}
              invoicesError={invoicesLoadError ? `Laskuja ei voitu hakea: ${errorText(invoicesLoadError)}` : null}
              onDone={setNotice}
            />
          </div>
        ))
      )}
    </div>
  );
};

export default PendingEntriesPage;
