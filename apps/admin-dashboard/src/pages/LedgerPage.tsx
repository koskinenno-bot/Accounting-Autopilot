import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getCompanies } from '../api/companies';
import { getAccounts, getLedgerByStatus } from '../api/accounting';
import { openVoucherFile } from '../api/vouchers';
import { FileText } from 'lucide-react';

const eur = (n: number | string) =>
  Number(n).toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

/** Pääkirja: kirjatut (POSTED) ja lukitut (LOCKED) viennit päivämääräjärjestyksessä. */
const LedgerPage = () => {
  const { t } = useTranslation();
  const { data: companies } = useQuery({ queryKey: ['companies'], queryFn: getCompanies });
  const companyId: string | undefined = companies?.[0]?.id;

  const { data: entries, isLoading } = useQuery({
    queryKey: ['postedLedger', companyId],
    queryFn: () => getLedgerByStatus(companyId as string, 'POSTED,LOCKED'),
    enabled: !!companyId,
  });
  const { data: accounts } = useQuery({
    queryKey: ['accounts', companyId],
    queryFn: () => getAccounts(companyId as string),
    enabled: !!companyId,
  });
  const name = (num: string) => accounts?.find((a: any) => a.accountNumber === num)?.accountName || '';
  const sorted = [...(entries || [])].sort((a, b) =>
    a.entryDate.localeCompare(b.entryDate) || a.voucherNumber.localeCompare(b.voucherNumber));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('ledger.title')}</h2>
        <p className="text-slate-400 mt-1">{t('ledger.subtitle')}</p>
      </div>

      <div className="glass-card overflow-hidden">
        {isLoading || !companies ? (
          <div className="p-8 text-center text-slate-400">{t('common.loading')}</div>
        ) : sorted.length === 0 ? (
          <div className="p-8 text-center text-slate-400">{t('ledger.empty')}</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-slate-400 border-b border-white/5">
                <th className="px-6 py-3 font-medium">Päivä</th>
                <th className="px-6 py-3 font-medium">Tosite</th>
                <th className="px-6 py-3 font-medium">Tili</th>
                <th className="px-6 py-3 font-medium text-right">{t('pending.debit')}</th>
                <th className="px-6 py-3 font-medium text-right">{t('pending.credit')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => (
                [
                  <tr key={entry.id} className="border-t border-white/10 bg-white/[0.02]">
                    <td className="px-6 pt-3 pb-1">{new Date(entry.entryDate).toLocaleDateString('fi-FI')}</td>
                    <td className="px-6 pt-3 pb-1 text-slate-400">{entry.voucherNumber}</td>
                    <td colSpan={3} className="px-6 pt-3 pb-1 font-medium">
                      {entry.description}
                      {entry.status === 'LOCKED' && <span className="ml-2 text-xs text-slate-500">(lukittu)</span>}
                      {entry.voucherId && (
                        <button
                          type="button"
                          onClick={() => openVoucherFile(entry.voucherId).catch(() => window.alert('Tositteen avaaminen epäonnistui'))}
                          className="ml-3 text-xs text-primary-400 hover:text-primary-300 inline-flex items-center gap-1"
                        >
                          <FileText className="w-3.5 h-3.5" />tosite
                        </button>
                      )}
                    </td>
                  </tr>,
                  ...entry.lines.map((l: any) => (
                    <tr key={l.id} className="text-slate-300">
                      <td colSpan={2} />
                      <td className="px-6 py-1">{l.accountNumber} {name(l.accountNumber)}</td>
                      <td className="px-6 py-1 text-right">{Number(l.debit) > 0 ? eur(l.debit) : ''}</td>
                      <td className="px-6 py-1 text-right">{Number(l.credit) > 0 ? eur(l.credit) : ''}</td>
                    </tr>
                  )),
                ]
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default LedgerPage;
