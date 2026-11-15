import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import { updateCompany } from '../api/companies';
import type { Company } from '../hooks/useCompany';

const group = (iban: string) => iban.replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();

/** Yhtiön tilinumero laskuille ja Finvoice-aineistolle. Isännöitsijä muokkaa, muut näkevät. */
const CompanyInfoCard = ({ company, canManage }: { company: Company; canManage: boolean }) => {
  const qc = useQueryClient();
  const current = company.settings?.iban || '';
  const [editing, setEditing] = useState(false);
  const [iban, setIban] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => updateCompany(company.id, { iban: iban.trim() || null }),
    onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: ['companies'] }); },
    onError: (err: any) => setError(err?.response?.data?.error || 'Tallennus epäonnistui'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setError(null); save.mutate(); };

  return (
    <div className="glass-card p-6 space-y-3">
      <h3 className="font-semibold flex items-center space-x-2"><Landmark className="w-5 h-5 text-primary-400" /><span>Yhtiön tilinumero</span></h3>
      {!editing ? (
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm">
            {current ? <span className="font-mono">{group(current)}</span> : <span className="text-amber-300">Tilinumero puuttuu. Sitä tarvitaan laskuihin ja Finvoice-aineistoon.</span>}
          </div>
          {canManage && (
            <button type="button" onClick={() => { setIban(current ? group(current) : ''); setEditing(true); }} className="text-primary-400 hover:text-primary-300 text-sm font-semibold">
              {current ? 'Muuta' : 'Lisää'}
            </button>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3">
          <input
            value={iban}
            onChange={(e) => setIban(e.target.value)}
            placeholder="FI00 0000 0000 0000 00"
            className="flex-1 bg-slate-900/50 border border-white/10 rounded-lg py-2 px-3 text-sm font-mono focus:outline-none focus:border-primary-500"
            autoFocus
          />
          <div className="flex gap-2">
            <button type="submit" disabled={save.isPending} className="premium-button premium-gradient text-white text-sm">Tallenna</button>
            <button type="button" onClick={() => { setEditing(false); setError(null); }} className="text-slate-400 hover:text-white text-sm px-3">Peru</button>
          </div>
        </form>
      )}
      {error && <div className="text-sm text-red-400">{error}</div>}
    </div>
  );
};

export default CompanyInfoCard;
