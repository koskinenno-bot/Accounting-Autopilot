import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Plus, Download, Search } from 'lucide-react';
import { getInvoices, downloadFinvoiceXml } from '../api/invoices';
import { useCompany } from '../hooks/useCompany';

const InvoicesPage = () => {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [xmlError, setXmlError] = useState<string | null>(null);

  const { selectedCompany, canWrite } = useCompany();
  
  const { data: invoices, isLoading } = useQuery({
    queryKey: ['invoices', selectedCompany?.id],
    queryFn: () => getInvoices(selectedCompany!.id),
    enabled: !!selectedCompany?.id,
  });

  // Haku numerolla tai vastaanottajalla
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !invoices) return invoices;
    return invoices.filter((i: any) => `${i.invoiceNumber} ${i.recipientName}`.toLowerCase().includes(q));
  }, [invoices, search]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{t('invoices.title')}</h2>
          <p className="text-slate-400 mt-1">Hallinnoi ja lähetä vastikelaskuja osakkaille.</p>
        </div>
        {/* Vastikelaskut luodaan Vastikkeet-sivulla osakasluettelon ja vastikeperusteiden pohjalta */}
        {canWrite && (
          <Link
            to="/fees"
            className="premium-button premium-gradient text-white flex items-center justify-center space-x-2"
          >
            <Plus className="w-5 h-5" />
            <span>{t('invoices.create')}</span>
          </Link>
        )}
      </div>

      {xmlError && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{xmlError}</div>
      )}

      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('common.search')} 
              className="w-full bg-slate-900/50 border border-white/10 rounded-lg py-2 pl-9 pr-4 text-sm focus:outline-none focus:border-primary-500 transition-all"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-slate-400 text-xs uppercase tracking-wider border-b border-white/5">
                <th className="px-6 py-4 font-semibold">{t('invoices.number')}</th>
                <th className="px-6 py-4 font-semibold">{t('invoices.recipient')}</th>
                <th className="px-6 py-4 font-semibold">{t('invoices.dueDate')}</th>
                <th className="px-6 py-4 font-semibold text-right">{t('invoices.amount')}</th>
                <th className="px-6 py-4 font-semibold text-center">{t('invoices.status')}</th>
                <th className="px-6 py-4 font-semibold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                [1, 2, 3].map(i => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={6} className="px-6 py-4 h-16 bg-white/5"></td>
                  </tr>
                ))
              ) : shown?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500 italic">
                    Ei laskuja. Aloita luomalla ensimmäinen lasku.
                  </td>
                </tr>
              ) : (
                shown?.map((invoice: any) => (
                  <tr key={invoice.id} className="hover:bg-white/2 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium">{invoice.invoiceNumber}</td>
                    <td className="px-6 py-4 text-sm">{invoice.recipientName}</td>
                    <td className="px-6 py-4 text-sm text-slate-400">{new Date(invoice.dueDate).toLocaleDateString('fi-FI')}</td>
                    <td className="px-6 py-4 text-sm text-right font-bold">{parseFloat(invoice.totalAmount).toLocaleString('fi-FI', { minimumFractionDigits: 2 })} €</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase border ${
                        invoice.status === 'PAID' 
                          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' 
                          : 'bg-primary-500/10 text-primary-500 border-primary-500/20'
                      }`}>
                        {invoice.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          type="button"
                          onClick={() => { setXmlError(null); downloadFinvoiceXml(invoice.id, invoice.invoiceNumber).catch((e) => setXmlError(e?.message || 'Lataus epäonnistui')); }}
                          className="p-1.5 text-slate-400 hover:text-primary-400 transition-colors"
                          title={t('invoices.downloadXml')}
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default InvoicesPage;
