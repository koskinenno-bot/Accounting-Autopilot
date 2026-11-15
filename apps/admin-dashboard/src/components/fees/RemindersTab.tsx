import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getReminders, sendReminders } from '../../api/fees';
import { ErrorBox, InfoBox, eur, errorText, fmtDate, periodLabel } from './common';

/** Erääntyneet vastikkeet: viivästyskorko tähän päivään ja muistutusten lähetys. */
const RemindersTab = ({ companyId, canWrite }: { companyId: string; canWrite: boolean }) => {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['reminders', companyId], queryFn: () => getReminders(companyId) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(new Set((data?.candidates ?? []).filter((c) => c.eligible).map((c) => c.invoiceId)));
  }, [data]);

  const send = useMutation({
    mutationFn: () => sendReminders(companyId, [...selected]),
    onSuccess: (r) => {
      setSendError(null);
      const total = r.sent.reduce((s, x) => s + x.total, 0);
      setMessage(`Lähetettiin ${r.sent.length} muistutusta. Muistutuskulut ja korot ${eur(total)} laskutettiin omilla viitteillään.`
        + (r.skipped.length ? ` Ohitettiin ${r.skipped.length}: ${r.skipped.map((s) => s.reason).join('; ')}` : ''));
      queryClient.invalidateQueries({ queryKey: ['reminders', companyId] });
      queryClient.invalidateQueries({ queryKey: ['reskontra', companyId] });
    },
    onError: (err) => setSendError(errorText(err)),
  });

  if (isLoading) return <div className="glass-card h-64 animate-pulse" />;
  if (error || !data) return <ErrorBox text="Muistutuksia ei saatu haettua laskutuspalvelusta." />;
  const { settings, candidates } = data;
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-4">
      <InfoBox>
        Viivästyskorko {settings.lateInterestRate?.toLocaleString('fi-FI')} % (viitekorko {settings.referenceRate.toLocaleString('fi-FI')} % + 7).
        Muistutus aikaisintaan {settings.reminderDaysAfterDue} pv eräpäivän jälkeen, muistutusmaksu {eur(settings.reminderFee)} ja
        maksuaika {settings.paymentTermDays} pv. {!settings.saved && 'Tarkista viitekorko Perusteet-välilehdellä ennen ensimmäistä muistutusta.'}
      </InfoBox>
      <ErrorBox text={sendError} />
      {message && <InfoBox>{message}</InfoBox>}
      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-white/5">
              <th className="p-3 w-8" />
              <th className="p-3 font-medium">Huoneisto</th>
              <th className="p-3 font-medium">Lasku</th>
              <th className="p-3 font-medium">Eräpäivä</th>
              <th className="p-3 font-medium text-right">Avoinna</th>
              <th className="p-3 font-medium text-right">Korko</th>
              <th className="p-3 font-medium text-right">Kulu</th>
              <th className="p-3 font-medium">Tila</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.invoiceId} className="border-b border-white/5">
                <td className="p-3">
                  <input type="checkbox" disabled={!c.eligible || !canWrite} checked={selected.has(c.invoiceId)} onChange={() => toggle(c.invoiceId)} />
                </td>
                <td className="p-3">
                  <div className="font-semibold">{c.apartment ?? '–'}</div>
                  <div className="text-xs text-slate-500">{c.recipientName}{!c.recipientEmail && ' · ei sähköpostia'}</div>
                </td>
                <td className="p-3">{c.invoiceNumber} {periodLabel(c.period)}</td>
                <td className="p-3">{fmtDate(c.dueDate)} <span className="text-xs text-rose-300">+{c.daysOverdue} pv</span></td>
                <td className="p-3 text-right font-mono">{eur(c.open)}</td>
                <td className="p-3 text-right font-mono">{eur(c.interest)}</td>
                <td className="p-3 text-right font-mono">{eur(c.fee)}</td>
                <td className="p-3 text-xs text-slate-400">{c.eligible ? 'Voidaan muistuttaa' : c.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {candidates.length === 0 && <div className="p-8 text-center text-slate-400">Ei erääntyneitä vastikkeita.</div>}
      </div>
      {canWrite && candidates.length > 0 && (
        <button type="button" className="premium-button premium-gradient text-white disabled:opacity-50"
          disabled={!selected.size || send.isPending} onClick={() => send.mutate()}>
          Lähetä {selected.size} muistutusta
        </button>
      )}
    </div>
  );
};

export default RemindersTab;
