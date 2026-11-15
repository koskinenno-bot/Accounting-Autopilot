import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Mail, CheckCircle, XCircle, Clock, Search, Filter } from 'lucide-react';
import { getNotificationHistory } from '../api/notifications';
import { useCompany } from '../hooks/useCompany';

const NotificationHistoryPage = () => {
  const { t } = useTranslation();

  const { selectedCompany } = useCompany();
  
  const { data: history, isLoading } = useQuery({
    queryKey: ['notification-history', selectedCompany?.id],
    queryFn: () => getNotificationHistory(selectedCompany!.id),
    enabled: !!selectedCompany?.id,
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'SENT': return <CheckCircle className="w-4 h-4 text-emerald-500" />;
      case 'FAILED': return <XCircle className="w-4 h-4 text-red-500" />;
      default: return <Clock className="w-4 h-4 text-primary-500" />;
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{t('notifications.title')}</h2>
          <p className="text-slate-400 mt-1">Seuraa ja hallinnoi taloyhtiön lähettämää viestintää.</p>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input 
              type="text" 
              placeholder={t('common.search')} 
              className="w-full bg-slate-900/50 border border-white/10 rounded-lg py-2 pl-9 pr-4 text-sm focus:outline-none focus:border-primary-500 transition-all"
            />
          </div>
          <button className="p-2 bg-slate-900/50 border border-white/10 rounded-lg text-slate-400 hover:text-white transition-all">
            <Filter className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-slate-400 text-xs uppercase tracking-wider border-b border-white/5">
                <th className="px-6 py-4 font-semibold">{t('notifications.recipient')}</th>
                <th className="px-6 py-4 font-semibold">{t('notifications.subject')}</th>
                <th className="px-6 py-4 font-semibold">{t('notifications.sentAt')}</th>
                <th className="px-6 py-4 font-semibold text-center">{t('notifications.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                [1, 2, 3].map(i => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={4} className="px-6 py-4 h-16 bg-white/5"></td>
                  </tr>
                ))
              ) : history?.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-500 italic">
                    Ei viestihistoriaa.
                  </td>
                </tr>
              ) : (
                history?.map((notif: any) => (
                  <tr key={notif.id} className="hover:bg-white/2 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="p-2 bg-white/5 rounded-lg">
                          <Mail className="w-4 h-4 text-slate-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{notif.recipient}</p>
                          <p className="text-[10px] text-slate-500 uppercase">{notif.type}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-300">
                      {notif.subject}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      {new Date(notif.sentAt || notif.createdAt).toLocaleString('fi-FI')}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center space-x-2">
                        {getStatusIcon(notif.status)}
                        <span className="text-[10px] font-bold uppercase tracking-tight">
                          {t(`notifications.${notif.status.toLowerCase()}`)}
                        </span>
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

export default NotificationHistoryPage;
