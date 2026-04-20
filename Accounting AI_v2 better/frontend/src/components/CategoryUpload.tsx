"use client";

import { useState, useRef } from 'react';
import { fetchWithAuth } from '@/lib/api';

export default function CategoryUpload({ companyId }: { companyId: number }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Only CSV files are accepted for the chart of accounts');
      return;
    }
    setLoading(true);
    setError('');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetchWithAuth(`/companies/${companyId}/categories/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      console.log('Chart of accounts uploaded', data);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setError(err.message || 'Failed to upload chart of accounts');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
      <button
        className="btn-primary"
        onClick={() => fileInputRef.current?.click()}
        disabled={loading}
      >
        {loading ? 'Uploading Chart...' : 'Upload Chart of Accounts (CSV)'}
      </button>
      <input
        type="file"
        accept=".csv"
        style={{ display: 'none' }}
        ref={fileInputRef}
        onChange={handleFileChange}
      />
      {error && <span style={{ color: 'var(--red-500)', fontSize: '14px' }}>{error}</span>}
    </div>
  );
}
