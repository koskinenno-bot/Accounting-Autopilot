import { PaymentDemand } from '@/types';
import { useLanguage } from '@/context/LanguageContext';

export default function InvoiceView({ demand }: { demand: PaymentDemand }) {
  const { t } = useLanguage();

  const formatEuro = (amount: number) => {
    return `EUR ${amount.toLocaleString(t('common.locale'), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Format Finnish Reference Number for readability (groups of 5)
  const formatReference = (ref: string) => {
    const reversed = ref.split('').reverse().join('');
    const grouped = reversed.match(/.{1,5}/g)?.join(' ') || reversed;
    return grouped.split('').reverse().join('');
  };

  // Format IBAN for readability
  const formatIBAN = (iban: string) => {
    return iban.match(/.{1,4}/g)?.join(' ') || iban;
  };

  return (
    <div className="invoice-container" style={{ 
      width: '210mm', 
      minHeight: '297mm', 
      padding: '20mm', 
      background: 'white', 
      color: 'black', 
      fontFamily: '"Inter", sans-serif',
      fontSize: '11px',
      margin: '0 auto',
      boxShadow: '0 0 20px rgba(0,0,0,0.5)',
      position: 'relative'
    }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .invoice-container, .invoice-container * { visibility: visible; }
          .invoice-container { position: absolute; left: 0; top: 0; box-shadow: none; margin: 0; padding: 0; width: 210mm; }
          .no-print { display: none; }
        }
      `}</style>

      {/* Top Header - Housing Company Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '40px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: '800', margin: '0 0 4px 0', color: '#1a1a1a' }}>{demand.receiver_name}</h1>
          <p style={{ margin: '0', opacity: 0.8 }}>{t('billing.businessId')}: {demand.receiver_business_id}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 4px 0', color: '#444' }}>{t('billing.invoiceTitle')}</h2>
          <p style={{ margin: '0', opacity: 0.8 }}>{t('billing.fee')}</p>
        </div>
      </div>

      {/* Payer Info */}
      <div style={{ marginBottom: '60px', width: '300px' }}>
        <p style={{ fontWeight: '700', marginBottom: '8px', borderBottom: '1px solid #eee', paddingBottom: '4px' }}>{t('billing.payerLabel')}</p>
        <p style={{ fontSize: '14px', margin: '0', fontWeight: '600' }}>{demand.owner_name}</p>
        <p style={{ fontSize: '14px', margin: '2px 0' }}>{t('billing.apartment')} {demand.apartment_number}</p>
      </div>

      {/* Middle Section - Payment Instructions */}
      <div style={{ marginBottom: '40px', padding: '20px', backgroundColor: '#f9f9f9', borderRadius: '4px', border: '1px solid #eee' }}>
        <p style={{ margin: '0 0 10px 0', fontSize: '12px' }}>
          {t('billing.barcodeNotice')}
        </p>
      </div>

      {/* BANK TRANSFER SLIP (TILISIIRTOLOMAKE) RECREATION */}
      <div style={{ 
        marginTop: 'auto', 
        border: '1.5px solid black', 
        padding: '0'
      }}>
        {/* Row 1: IBAN & SWIFT (Simplified) */}
        <div style={{ display: 'flex', borderBottom: '1px solid black' }}>
          <div style={{ flex: 1, padding: '8px', borderRight: '1px solid black' }}>
            <div style={{ fontSize: '8px', fontWeight: '700', textTransform: 'uppercase' }}>{t('billing.ibanLabel')}</div>
            <div style={{ fontSize: '14px', fontWeight: '700', marginTop: '4px' }}>{formatIBAN(demand.iban)}</div>
          </div>
          <div style={{ width: '150px', padding: '8px' }}>
            <div style={{ fontSize: '8px', fontWeight: '700', textTransform: 'uppercase' }}>BIC</div>
            <div style={{ fontSize: '14px', fontWeight: '700', marginTop: '4px' }}>FI... {t('billing.bankName')}</div>
          </div>
        </div>

        {/* Row 2: Receiver Info */}
        <div style={{ borderBottom: '1px solid black', padding: '8px' }}>
          <div style={{ fontSize: '8px', fontWeight: '700', textTransform: 'uppercase' }}>{t('billing.receiverLabel')}</div>
          <div style={{ fontSize: '14px', fontWeight: '700', marginTop: '4px' }}>{demand.receiver_name}</div>
        </div>

        {/* Row 3: Payer Info */}
        <div style={{ borderBottom: '1px solid black', padding: '8px', height: '80px' }}>
          <div style={{ fontSize: '8px', fontWeight: '700', textTransform: 'uppercase' }}>{t('billing.payerLabel')}</div>
          <div style={{ fontSize: '14px', marginTop: '4px' }}>
            {demand.owner_name}<br />
            {t('billing.apartment')} {demand.apartment_number}
          </div>
        </div>

        {/* Row 4: Signature / Metadata */}
        <div style={{ display: 'flex', borderBottom: '1px solid black' }}>
          <div style={{ flex: 1, padding: '8px', borderRight: '1px solid black' }}>
            <div style={{ fontSize: '8px', fontWeight: '700', textTransform: 'uppercase' }}>{t('billing.signatureLabel')}</div>
          </div>
          <div style={{ width: '150px', padding: '8px' }}>
            <div style={{ fontSize: '8px', fontWeight: '700', textTransform: 'uppercase' }}>{t('billing.dateLabel')}</div>
            <div style={{ fontSize: '14px', marginTop: '4px' }}>{new Date().toLocaleDateString(t('common.locale'))}</div>
          </div>
        </div>

        {/* Row 5: Reference, Due Date, Total */}
        <div style={{ display: 'flex' }}>
          <div style={{ flex: 2, padding: '8px', borderRight: '1px solid black' }}>
            <div style={{ fontSize: '8px', fontWeight: '700', textTransform: 'uppercase' }}>{t('billing.refLabel')}</div>
            <div style={{ fontSize: '18px', fontWeight: '800', marginTop: '10px', textAlign: 'center', letterSpacing: '2px' }}>
              {formatReference(demand.reference_number)}
            </div>
          </div>
          <div style={{ flex: 1, padding: '8px', borderRight: '1px solid black' }}>
            <div style={{ fontSize: '8px', fontWeight: '700', textTransform: 'uppercase' }}>{t('billing.dueDateLabel')}</div>
            <div style={{ fontSize: '18px', fontWeight: '800', marginTop: '10px', textAlign: 'center' }}>
              {new Date(demand.due_date).toLocaleDateString(t('common.locale'))}
            </div>
          </div>
          <div style={{ flex: 1, padding: '8px' }}>
            <div style={{ fontSize: '8px', fontWeight: '700', textTransform: 'uppercase' }}>{t('billing.euroLabel')}</div>
            <div style={{ fontSize: '20px', fontWeight: '900', marginTop: '8px', textAlign: 'right' }}>
              {demand.amount.toFixed(2).replace('.', ',')}
            </div>
          </div>
        </div>
      </div>

      {/* VIRTUAL BARCODE SECTION */}
      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        <p style={{ fontSize: '9px', textTransform: 'uppercase', marginBottom: '8px', opacity: 0.6 }}>{t('billing.barcodeLabel')}</p>
        <div style={{ 
          fontFamily: 'monospace', 
          fontSize: '12px', 
          background: '#eee', 
          padding: '8px', 
          letterSpacing: '1px',
          border: '1px dashed #ccc'
        }}>
          {demand.virtual_barcode}
        </div>
        <p style={{ fontSize: '8px', marginTop: '4px', opacity: 0.5 }}>
          {t('billing.barcodeCopyTip')}
        </p>
      </div>

      {/* Print Button - No print */}
      <div className="no-print" style={{ 
        marginTop: '60px', 
        display: 'flex', 
        justifyContent: 'center'
      }}>
        <button 
          onClick={() => window.print()}
          className="btn-primary"
          style={{ padding: '12px 24px', borderRadius: '8px', cursor: 'pointer' }}
        >
          {t('billing.printFull')}
        </button>
      </div>
    </div>
  );
}
