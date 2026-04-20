"use client";

import React, { useRef, useState } from 'react';
import { fetchWithAuth, API_URL } from '@/lib/api';

interface ReceiptManagerProps {
  companyId: string | number;
  transactionId: number;
  initialReceiptUrl?: string | null;
  onUpdate: (newUrl: string | null) => void;
  disabled?: boolean;
}

export default function ReceiptManager({ companyId, transactionId, initialReceiptUrl, onUpdate, disabled }: ReceiptManagerProps) {
  const [receiptUrl, setReceiptUrl] = useState(initialReceiptUrl);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetchWithAuth(`/companies/${companyId}/transactions/${transactionId}/receipt`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      setReceiptUrl(data.receipt_url);
      onUpdate(data.receipt_url);
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Upload failed");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this receipt?")) return;

    try {
      await fetchWithAuth(`/companies/${companyId}/transactions/${transactionId}/receipt`, {
        method: 'DELETE',
      });
      setReceiptUrl(null);
      onUpdate(null);
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Delete failed");
    }
  };

  const handleView = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (receiptUrl) {
      // API_URL is something like http://localhost:8000
      // receiptUrl is /uploads/receipts/...
      window.open(`${API_URL}${receiptUrl}`, '_blank');
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {receiptUrl ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={handleView}
            disabled={disabled}
            style={{
              padding: '6px',
              borderRadius: '50%',
              background: 'rgba(59, 130, 246, 0.1)',
              color: 'var(--blue-400)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s'
            }}
            title="View Receipt"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
               <polyline points="14 2 14 8 20 8"></polyline>
               <line x1="16" y1="13" x2="8" y2="13"></line>
               <line x1="16" y1="17" x2="8" y2="17"></line>
               <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
          </button>
          <button
            onClick={handleDelete}
            disabled={disabled}
            style={{
              padding: '4px',
              borderRadius: '50%',
              background: 'transparent',
              color: 'var(--red-500)',
              border: 'none',
              cursor: 'pointer',
              opacity: 0.4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'opacity 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '0.4'}
            title="Remove"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <line x1="18" y1="6" x2="6" y2="18"></line>
               <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      ) : (
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading || disabled}
          style={{
            padding: '6px',
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.05)',
            color: (isUploading || disabled) ? '#666' : 'var(--text-secondary)',
            border: '1px dashed rgba(255, 255, 255, 0.2)',
            cursor: (isUploading || disabled) ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s'
          }}
          title="Upload Receipt"
        >
          {isUploading ? (
            <span style={{ fontSize: '10px' }}>⏳</span>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <line x1="12" y1="5" x2="12" y2="19"></line>
               <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          )}
        </button>
      )}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleUpload}
        style={{ display: 'none' }}
        accept=".pdf,.jpg,.jpeg,.png"
      />
    </div>
  );
}
