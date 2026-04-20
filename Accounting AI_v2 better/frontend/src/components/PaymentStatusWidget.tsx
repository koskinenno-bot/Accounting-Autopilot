"use client";

import { PaymentStatus } from '@/types';
import { useLanguage } from '@/context/LanguageContext';

export default function PaymentStatusWidget({ statuses, companyId, onViewInvoice }: { 
  statuses: PaymentStatus[], 
  companyId?: string | number,
  onViewInvoice?: (apartmentId: number) => void 
}) {
  const { t } = useLanguage();
  const paidCount = statuses.filter(s => s.paid).length;
  const totalCount = statuses.length;

  return (
    <div className="card-glass" style={{ padding: '24px', marginTop: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '20px', fontWeight: '600' }}>{t('billing.statusTitle')}</h3>
        <span className="badge" style={{ background: 'rgba(59, 130, 246, 0.2)', color: 'var(--blue-500)' }}>
          {paidCount} / {totalCount} {t('billing.paid')}
        </span>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>{t('billing.apt')}</th>
              <th>{t('billing.owner')}</th>
              <th>{t('billing.fee')}</th>
              <th>{t('common.status')}</th>
              <th style={{ textAlign: 'right' }}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {statuses.map(s => (
              <tr key={s.apartment_id}>
                <td style={{ fontWeight: '500' }}>{s.apartment_number}</td>
                <td>{s.owner_name}</td>
                <td>€{s.monthly_fee.toFixed(2)}</td>
                <td>
                  {s.paid ? (
                    <span style={{ color: 'var(--green-500)', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
                      <span style={{ fontSize: '18px' }}>✓</span> {t('billing.paid')}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--red-500)', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
                      <span style={{ fontSize: '18px' }}>✗</span> {t('billing.missing')}
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button 
                    onClick={() => onViewInvoice && onViewInvoice(s.apartment_id)}
                    className="btn-secondary"
                    style={{ 
                      padding: '6px 12px', 
                      fontSize: '12px', 
                      display: 'inline-flex', 
                      gap: '6px', 
                      alignItems: 'center',
                      background: !s.paid ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                      border: !s.paid ? '1px solid var(--glass-border)' : '1px solid transparent'
                    }}
                  >
                    <span>📄</span> {t('billing.invoice')}
                  </button>
                </td>
              </tr>
            ))}
            {statuses.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{t('billing.noApartments')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
