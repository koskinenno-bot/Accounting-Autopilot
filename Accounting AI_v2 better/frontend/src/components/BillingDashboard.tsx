import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { fetchWithAuth } from '@/lib/api';
import { Apartment, PaymentDemand } from '@/types';
import InvoiceView from './InvoiceView';
import { useLanguage } from '@/context/LanguageContext';

export default function BillingDashboard() {
  const { id } = useParams();
  const { t } = useLanguage();
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<PaymentDemand | null>(null);
  const [bulkInvoices, setBulkInvoices] = useState<PaymentDemand[]>([]);
  const [isBulkMode, setIsBulkMode] = useState(false);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await fetchWithAuth(`/companies/${id}/apartments`);
      const data = await res.json();
      setApartments(data);
    } catch (err) {
      console.error('Failed to load apartments for billing:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const generateInvoice = async (aptId: number) => {
    try {
      const res = await fetchWithAuth(`/companies/${id}/apartments/${aptId}/invoice`);
      if (res.ok) {
        setSelectedInvoice(await res.json());
      }
    } catch (err) {
      console.error('Failed to generate invoice:', err);
    }
  };

  const handleBulkGenerate = async () => {
    setLoading(true);
    setIsBulkMode(true);
    const invoices: PaymentDemand[] = [];
    try {
      for (const apt of apartments) {
        const res = await fetchWithAuth(`/companies/${id}/apartments/${apt.id}/invoice`);
        if (res.ok) {
          invoices.push(await res.json());
        }
      }
      setBulkInvoices(invoices);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !isBulkMode) return <div style={{ padding: '40px' }}>{t('common.loading')}</div>;

  if (selectedInvoice || (isBulkMode && bulkInvoices.length > 0)) {
    return (
      <div style={{ padding: '20px' }}>
        <div className="no-print" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between' }}>
          <button 
            onClick={() => { setSelectedInvoice(null); setIsBulkMode(false); setBulkInvoices([]); }}
            className="btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            ← {t('common.back')}
          </button>
          <button 
            onClick={() => window.print()}
            className="btn-primary"
            style={{ background: 'var(--green-500)' }}
          >
            🖨️ {t('billing.printPdf')}
          </button>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
          {selectedInvoice ? (
            <InvoiceView demand={selectedInvoice} />
          ) : (
            bulkInvoices.map((inv, idx) => (
              <div key={idx} style={{ pageBreakAfter: 'always' }}>
                <InvoiceView demand={inv} />
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '0' }}>
      <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '32px', fontWeight: '800', marginBottom: '8px' }}>{t('billing.title')}</h1>
          <p style={{ color: 'var(--text-secondary)' }}>{t('billing.subtitle')}</p>
        </div>
        <button 
          onClick={handleBulkGenerate}
          className="btn-primary"
          style={{ background: 'var(--blue-500)', display: 'flex', gap: '8px', alignItems: 'center' }}
        >
          <span>📦</span> {t('billing.generateAll')}
        </button>
      </div>

      <div className="card-glass" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.05)', textAlign: 'left', borderBottom: '1px solid var(--glass-border)' }}>
              <th style={{ padding: '16px 24px' }}>{t('billing.apt')}</th>
              <th style={{ padding: '16px 24px' }}>{t('billing.owner')}</th>
              <th style={{ padding: '16px 24px', textAlign: 'right' }}>{t('billing.fee')}</th>
              <th style={{ padding: '16px 24px', textAlign: 'right' }}>{t('billing.refNumber')}</th>
              <th style={{ padding: '16px 24px', textAlign: 'center' }}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {apartments.map((apt) => (
              <tr key={apt.id} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                <td style={{ padding: '16px 24px', fontWeight: '700' }}>{apt.apartment_number}</td>
                <td style={{ padding: '16px 24px' }}>{apt.owner_name}</td>
                <td style={{ padding: '16px 24px', textAlign: 'right', fontWeight: '600' }}>
                  {apt.monthly_fee.toLocaleString(t('common.locale'))} €
                </td>
                <td style={{ padding: '16px 24px', textAlign: 'right', fontFamily: 'monospace', opacity: 0.7 }}>
                  {apt.reference_number}
                </td>
                <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                  <button 
                    onClick={() => generateInvoice(apt.id)}
                    className="btn-secondary"
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    {t('billing.createInvoice')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '32px', padding: '24px', background: 'rgba(59, 130, 246, 0.05)', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
        <h4 style={{ margin: '0 0 8px 0', color: 'var(--blue-400)' }}>⚙️ {t('billing.tipTitle')}</h4>
        <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)' }}>
          {t('billing.tipContent')}
        </p>
      </div>
    </div>
  );
}
