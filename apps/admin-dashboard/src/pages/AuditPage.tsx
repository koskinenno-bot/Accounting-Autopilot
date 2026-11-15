import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { History, User, Activity, Globe, Info, Search, ShieldCheck, ShieldAlert } from 'lucide-react';
import { getAuditLogs, verifyAuditLog } from '../api/audit';
import { useCompany } from '../hooks/useCompany';

const AuditPage = () => {
  const { t } = useTranslation();

  const { selectedCompany } = useCompany();
  
  const { data: logs, isLoading } = useQuery({
    queryKey: ['audit-logs', selectedCompany?.id],
    queryFn: () => getAuditLogs(selectedCompany?.id),
    enabled: !!selectedCompany?.id,
  });

  const { data: integrity } = useQuery({
    queryKey: ['audit-verify', selectedCompany?.id],
    queryFn: () => verifyAuditLog(selectedCompany!.id),
    enabled: !!selectedCompany?.id,
  });

  const getActionColor = (action: string) => {
    switch (action) {
      case 'CREATE': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'DELETE': return 'text-red-400 bg-red-500/10 border-red-500/20';
      case 'UPDATE': return 'text-primary-400 bg-primary-500/10 border-primary-500/20';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{t('audit.title')}</h2>
          <p className="text-slate-400 mt-1">Virallinen ja muuttumaton tallenne kaikista järjestelmän tapahtumista.</p>
        </div>
        {integrity && (integrity.ok ? (
          <div className="flex items-center gap-2 text-sm text-emerald-300 px-3 py-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10"
            title="Jokainen tapahtuma sisältää edellisen tapahtuman tiivisteen. Muutettu tai poistettu tapahtuma näkyisi katkoksena.">
            <ShieldCheck className="w-4 h-4" />Eheys tarkistettu: {integrity.checked} tapahtumaa{integrity.legacy ? `, ${integrity.legacy} vanhaa ennen ketjutusta` : ''}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-rose-300 px-3 py-2 rounded-xl border border-rose-500/30 bg-rose-500/10">
            <ShieldAlert className="w-4 h-4" />Eheys rikki: {integrity.reason}
          </div>
        ))}
      </div>

      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b border-white/5 bg-white/2">
          <div className="relative max-w-sm w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input 
              type="text" 
              placeholder="Hae arkistosta..." 
              className="w-full bg-slate-900/50 border border-white/10 rounded-lg py-2 pl-9 pr-4 text-sm focus:outline-none focus:border-primary-500"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-slate-400 text-xs uppercase tracking-wider border-b border-white/5">
                <th className="px-6 py-4 font-semibold">{t('audit.timestamp')}</th>
                <th className="px-6 py-4 font-semibold">{t('audit.user')}</th>
                <th className="px-6 py-4 font-semibold">{t('audit.action')}</th>
                <th className="px-6 py-4 font-semibold">{t('audit.entity')}</th>
                <th className="px-6 py-4 font-semibold">{t('audit.description')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                [1, 2, 3, 4, 5].map(i => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={5} className="px-6 py-4 h-12 bg-white/2"></td>
                  </tr>
                ))
              ) : logs?.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center text-slate-500 italic">
                    <div className="flex flex-col items-center space-y-2">
                       <History className="w-8 h-8 opacity-20" />
                       <span>Ei muutosloki-tapahtumia.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                logs?.map((log: any) => (
                  <tr key={log.id} className="hover:bg-white/2 transition-colors">
                    <td className="px-6 py-4 text-xs font-mono text-slate-400">
                      {new Date(log.createdAt).toLocaleString('fi-FI')}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <User className="w-3.5 h-3.5 text-slate-500" />
                        <span className="text-sm font-medium">{log.userId}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-md text-[10px] font-bold border ${getActionColor(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <Activity className="w-3.5 h-3.5 text-slate-500" />
                        <span className="text-xs font-semibold text-slate-300">{log.entityType}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                       <div className="flex flex-col">
                          <span className="text-sm text-slate-300">{log.description}</span>
                          <div className="flex items-center space-x-2 mt-1 opacity-50">
                             <Globe className="w-3 h-3" />
                             <span className="text-[10px] font-mono">{log.ipAddress}</span>
                          </div>
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

export default AuditPage;
