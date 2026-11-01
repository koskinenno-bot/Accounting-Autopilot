import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getFiscalYears } from '../api/accounting';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('fi-FI', { timeZone: 'UTC' });

export const fiscalYearLabel = (fy: any) =>
  `${fmt(fy.startDate)}–${fmt(fy.endDate)}${fy.status === 'CLOSED' ? ' (suljettu)' : ''}`;

/**
 * Tilikauden valinta. Oletus = vanhin avoin tilikausi (sama kuin reporting-servicen oletus),
 * joten raportit, tilinpäätös ja pääkirja näyttävät saman kauden.
 */
const FiscalYearSelect = ({ companyId, value, onChange }: { companyId?: string; value?: string; onChange: (id: string) => void }) => {
  const { data: years } = useQuery({
    queryKey: ['fiscalYears', companyId],
    queryFn: () => getFiscalYears(companyId as string),
    enabled: !!companyId,
  });

  useEffect(() => {
    if (!years?.length || (value && years.some((y: any) => y.id === value))) return;
    const open = years.filter((y: any) => y.status === 'OPEN').sort((a: any, b: any) => a.startDate.localeCompare(b.startDate));
    onChange((open[0] || years[0]).id);
  }, [years, value, onChange]);

  if (!years?.length) return null;
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      className="bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm"
      aria-label="Tilikausi"
    >
      {years.map((y: any) => <option key={y.id} value={y.id}>Tilikausi {fiscalYearLabel(y)}</option>)}
    </select>
  );
};

export default FiscalYearSelect;
