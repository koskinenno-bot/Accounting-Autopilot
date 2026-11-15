import type { ReactNode } from 'react';

export const eur = (n: number) => `${n.toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('fi-FI') : '–');
export const errorText = (err: any) => err?.response?.data?.error || 'Toiminto epäonnistui';
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const periodLabel = (p: string | null) => (p ? `${Number(p.slice(5))}/${p.slice(0, 4)}` : '');

export const inputClass = 'bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-500';
export const smallButton = 'px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-200 hover:text-white disabled:opacity-50';

export const ErrorBox = ({ text }: { text: string | null }) =>
  text ? <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{text}</div> : null;

export const InfoBox = ({ children }: { children: ReactNode }) => (
  <div className="p-3 rounded-lg bg-primary-500/10 border border-primary-500/20 text-slate-200 text-sm">{children}</div>
);
