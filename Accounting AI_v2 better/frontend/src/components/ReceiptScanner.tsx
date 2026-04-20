"use client";

import { useState, useRef } from 'react';
import { fetchWithAuth } from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';

export default function ReceiptScanner({ companyId, onScanComplete }: { 
  companyId: string, 
  onScanComplete: (result: any) => void 
}) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetchWithAuth(`/companies/${companyId}/transactions/scan-receipt`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      onScanComplete(data);
    } catch (err) {
      console.error("Scan failed", err);
      alert(t('common.error'));
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="card-glass" style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '4px' }}>{t('transactions.aiScan.title')}</h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          {t('transactions.aiScan.summary').replace('${count}', 'AI')}
        </p>
      </div>
      
      <button 
        className="btn-primary" 
        onClick={() => fileInputRef.current?.click()}
        disabled={loading}
        style={{ background: 'var(--purple-500)', display: 'flex', alignItems: 'center', gap: '8px' }}
      >
        <span>{loading ? '⏳' : '📸'}</span>
        {loading ? t('transactions.aiScan.scanning') : t('transactions.aiScan.button')}
      </button>

      <input 
        type="file" 
        accept="image/*, application/pdf" 
        style={{ display: 'none' }} 
        ref={fileInputRef}
        onChange={handleFileChange}
      />
    </div>
  );
}
