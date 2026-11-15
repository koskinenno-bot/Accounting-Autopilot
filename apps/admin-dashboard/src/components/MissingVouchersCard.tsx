import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileQuestion, Send } from 'lucide-react';
import { getMissingVouchers, requestMissingVouchers } from '../api/accounting';

const eur = (n: number) => n.toLocaleString('fi-FI', { style: 'currency', currency: 'EUR' });
const fi = (d: string) => new Date(d).toLocaleDateString('fi-FI', { timeZone: 'UTC' });

/** Puuttuvat tositteet ja niiden pyyntö sähköpostilla (vastaus tulee käyttäjän omaan sähköpostiin). */
const MissingVouchersCard = ({ companyId, canWrite, userEmail }: { companyId: string; canWrite: boolean; userEmail?: string }) => {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['missingVouchers', companyId], queryFn: () => getMissingVouchers(companyId) });
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const send = useMutation({
    mutationFn: () => requestMissingVouchers({ companyId, recipient, replyTo: userEmail, message }),
    onSuccess: (r) => {
      setNotice({ ok: true, text: `Pyyntö lähetetty (${r.requested} tositetta). Vastaukset tulevat osoitteeseen ${userEmail ?? 'lähettäjälle'}.` });
      setMessage('');
      qc.invalidateQueries({ queryKey: ['missingVouchers', companyId] });
      qc.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: (err: any) => setNotice({ ok: false, text: err?.response?.data?.error || 'Lähetys epäonnistui' }),
  });
  if (!data || data.length === 0) return null;
  const submit = (e: FormEvent) => { e.preventDefault(); setNotice(null); send.mutate(); };

  return (
    <div className="glass-card p-6 space-y-4">
      <h3 className="font-semibold flex items-center space-x-2"><FileQuestion className="w-5 h-5 text-amber-300" /><span>Puuttuvat tositteet ({data.length})</span></h3>
      <ul className="text-sm divide-y divide-white/5 max-h-56 overflow-y-auto">
        {data.map((v) => (
          <li key={v.id} className="py-1.5 flex justify-between gap-3">
            <span>{fi(v.entryDate)} · {v.counterparty || v.description || 'pankkimeno'}</span>
            <span className="text-slate-400 whitespace-nowrap">
              {eur(v.amount)}{v.voucherRequestedAt && <span className="text-xs text-slate-500"> · pyydetty {fi(v.voucherRequestedAt)}</span>}
            </span>
          </li>
        ))}
      </ul>
      {canWrite && (
        <form onSubmit={submit} className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <input type="email" required value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Vastaanottaja, esim. hallituksen puheenjohtaja"
              className="flex-1 min-w-[14rem] bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2" />
            <button type="submit" disabled={send.isPending} className="px-3 py-2 rounded-lg bg-primary-500 hover:bg-primary-400 disabled:opacity-50 font-semibold inline-flex items-center gap-2">
              <Send className="w-4 h-4" />Pyydä tositteet
            </button>
          </div>
          <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} placeholder="Lisäviesti (valinnainen)"
            className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2" />
        </form>
      )}
      {notice && <div className={`text-sm ${notice.ok ? 'text-emerald-300' : 'text-red-400'}`}>{notice.text}</div>}
    </div>
  );
};

export default MissingVouchersCard;
