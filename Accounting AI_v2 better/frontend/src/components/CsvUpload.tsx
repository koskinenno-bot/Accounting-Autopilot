"use client";

import { useRef, useState } from 'react';
import { fetchWithAuth } from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';

export default function CsvUpload({ companyId, onUploadSuccess }: { companyId: number, onUploadSuccess: (results: any) => void }) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError('');

    const formData = new FormData();
    formData.append('file', file);

    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    const endpoint = isPdf
      ? `/companies/${companyId}/transactions/import-pdf`
      : `/companies/${companyId}/transactions/import`;

    try {
      const res = await fetchWithAuth(endpoint, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      onUploadSuccess(data);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setError(err.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
      <button 
        className="btn-primary" 
        onClick={() => fileInputRef.current?.click()}
        disabled={loading}
      >
        {loading ? t('transactions.processing') : t('transactions.setup.step2')}
      </button>
      <input 
        type="file" 
        accept=".csv, .pdf" 
        style={{ display: 'none' }} 
        ref={fileInputRef}
        onChange={handleFileChange}
      />
      {error && <span style={{ color: 'var(--red-500)', fontSize: '14px' }}>{error}</span>}
    </div>
  );
}
