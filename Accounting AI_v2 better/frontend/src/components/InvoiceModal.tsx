"use client";

import React, { useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/api';
import { PaymentDemand } from '@/types';
import { useLanguage } from '@/context/LanguageContext';

interface InvoiceModalProps {
  companyId: string | number;
  apartmentId: number | null;
  onClose: () => void;
}

export default function InvoiceModal({ companyId, apartmentId, onClose }: InvoiceModalProps) {
  const { t } = useLanguage();
  const [data, setData] = useState<PaymentDemand | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (apartmentId) {
      const loadInvoice = async () => {
        setLoading(true);
        try {
          const res = await fetchWithAuth(`/companies/${companyId}/apartments/${apartmentId}/invoice`);
          const invoiceData = await res.json();
          setData(invoiceData);
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      };
      loadInvoice();
    }
  }, [companyId, apartmentId]);

  if (!apartmentId) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="modal-overlay" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000, overflowY: 'auto', padding: '40px 0'
    }}>
      <div className="modal-content" style={{
        background: 'white', color: '#1a1a1a',
        width: '100%', maxWidth: '800px',
        borderRadius: '12px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        position: 'relative'
      }}>
        
        {/* Modal Header (Hidden in Print) */}
        <div className="no-print" style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 24px', borderBottom: '1px solid #eee'
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: '700' }}>{t('billing.previewHeader')}</h2>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={handlePrint} className="btn-primary" style={{ background: '#1a1a1a' }}>
              {t('billing.printPdf')}
            </button>
            <button onClick={onClose} className="btn-secondary" style={{ color: '#666' }}>
              {t('common.close')}
            </button>
          </div>
        </div>

        {/* Invoice Page Body */}
        <div id="invoice-printable" style={{
          padding: '60px 80px', minHeight: '1000px',
          fontFamily: "'Inter', sans-serif"
        }}>
          {loading ? (
            <div style={{ textAlign: 'center', marginTop: '100px' }}>{t('common.loading')}</div>
          ) : data ? (
            <>
              {/* Top Section */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '60px' }}>
                <div>
                  <h1 style={{ fontSize: '24px', fontWeight: '800', marginBottom: '20px', textTransform: 'uppercase' }}>
                    {t('billing.invoiceTitle')}
                  </h1>
                  <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                    <strong>{data.receiver_name}</strong><br />
                    {t('billing.businessId')}: {data.receiver_business_id}<br />
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '13px' }}>
                  <div style={{ marginBottom: '10px' }}>
                    <strong>{t('billing.date')}:</strong> {new Date().toLocaleDateString(t('common.locale'))}<br />
                    <strong>{t('billing.dueDate')}:</strong> {new Date(data.due_date).toLocaleDateString(t('common.locale'))}
                  </div>
                </div>
              </div>

              {/* Recipient */}
              <div style={{ marginBottom: '60px' }}>
                <div style={{ fontSize: '12px', textTransform: 'uppercase', color: '#666', marginBottom: '8px' }}>{t('billing.payer')}:</div>
                <div style={{ fontSize: '15px', fontWeight: '600' }}>
                  {data.owner_name}<br />
                  {t('billing.apartment')}: {data.apartment_number}
                </div>
              </div>

              {/* Table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '60px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #1a1a1a', fontSize: '12px', textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', padding: '12px 0' }}>{t('billing.description')}</th>
                    <th style={{ textAlign: 'right', padding: '12px 0' }}>{t('billing.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #eee', fontSize: '14px' }}>
                    <td style={{ padding: '16px 0' }}>Hoitovastike (Current Month)</td>
                    <td style={{ textAlign: 'right', padding: '16px 0', fontWeight: '600' }}>{data.amount.toFixed(2)} €</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ textAlign: 'right', padding: '24px 0', fontWeight: '800', fontSize: '18px' }}>{t('billing.total')}:</td>
                    <td style={{ textAlign: 'right', padding: '24px 0', fontWeight: '800', fontSize: '18px' }}>{data.amount.toFixed(2)} €</td>
                  </tr>
                </tfoot>
              </table>

              {/* Payment Details */}
              <div style={{ 
                background: '#f9f9f9', padding: '30px', borderRadius: '8px', 
                fontSize: '13px', marginBottom: '60px', border: '1px solid #eee' 
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <div>
                    <div style={{ color: '#666', marginBottom: '4px' }}>{t('billing.iban')}</div>
                    <div style={{ fontWeight: '700', fontSize: '15px' }}>{data.iban}</div>
                  </div>
                  <div>
                    <div style={{ color: '#666', marginBottom: '4px' }}>{t('billing.refNumber')}</div>
                    <div style={{ fontWeight: '700', fontSize: '15px' }}>{data.reference_number}</div>
                  </div>
                </div>
              </div>

              {/* Virtual Barcode */}
              <div style={{ marginTop: 'auto', borderTop: '1px dashed #ccc', paddingTop: '40px' }}>
                <div style={{ fontSize: '11px', color: '#666', marginBottom: '10px', textAlign: 'center', textTransform: 'uppercase' }}>
                  {t('billing.barcodeTitle')}
                </div>
                <div style={{ 
                  fontFamily: "'Courier New', Courier, monospace",
                  fontSize: '14px',
                  letterSpacing: '2px',
                  background: '#000',
                  color: '#fff',
                  padding: '16px',
                  textAlign: 'center',
                  borderRadius: '4px',
                  wordBreak: 'break-all'
                }}>
                  {data.virtual_barcode}
                </div>
                <p style={{ fontSize: '10px', color: '#999', marginTop: '12px', textAlign: 'center' }}>
                  {t('billing.barcodeNotice')}
                </p>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', color: 'red' }}>Error loading invoice.</div>
          )}
        </div>
      </div>
      
      <style jsx>{`
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            background: white !important;
          }
          .modal-overlay {
            position: absolute !important;
            background: white !important;
            padding: 0 !important;
            overflow: visible !important;
          }
          .modal-content {
            box-shadow: none !important;
            width: 100% !important;
            max-width: none !important;
          }
          #invoice-printable {
            padding: 0 !important;
          }
        }
      `}</style>
    </div>
  );
}
