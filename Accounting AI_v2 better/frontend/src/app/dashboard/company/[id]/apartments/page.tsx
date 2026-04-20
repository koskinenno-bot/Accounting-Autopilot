"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { fetchWithAuth } from '@/lib/api';
import { Apartment } from '@/types';
import { useLanguage } from '@/context/LanguageContext';

export default function ApartmentsPage() {
  const { id } = useParams();
  const { t } = useLanguage();
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadApartments = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await fetchWithAuth(`/companies/${id}/apartments/`);
      setApartments(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadApartments();
  }, [loadApartments]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      setLoading(true);
      const res = await fetchWithAuth(`/companies/${id}/apartments/bulk-import`, {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        loadApartments();
      }
    } catch (err) {
      alert("Virhe tiedoston latauksessa.");
    } finally {
      setLoading(false);
    }
  };

  if (loading && apartments.length === 0) return <div style={{ padding: '40px' }}>{t('common.loading')}</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '32px', fontWeight: '800', marginBottom: '8px' }}>🏢 Huoneistot</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Hallitse taloyhtiön osakkaita ja vastikkeita.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
             <button className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
                📥 Tuo Excel/CSV
             </button>
             <input type="file" ref={fileInputRef} hidden accept=".csv,.txt" onChange={handleFileUpload} />
             <button className="btn-primary" onClick={() => {/* TODO: Manual Add */}}>
                + Lisää huoneisto
             </button>
        </div>
      </div>

      <div className="card-glass" style={{ padding: '0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid var(--glass-border)' }}>
            <tr>
              <th style={{ textAlign: 'left', padding: '16px 24px', fontSize: '12px' }}>NRO</th>
              <th style={{ textAlign: 'left', padding: '16px 24px', fontSize: '12px' }}>OMISTAJA</th>
              <th style={{ textAlign: 'right', padding: '16px 24px', fontSize: '12px' }}>HOITOVASTIKE</th>
              <th style={{ textAlign: 'right', padding: '16px 24px', fontSize: '12px' }}>VIITENUMERO</th>
            </tr>
          </thead>
          <tbody>
            {apartments.length === 0 && (
                <tr>
                    <td colSpan={4} style={{ padding: '60px', textAlign: 'center', opacity: 0.5 }}>
                        Ei huoneistoja. Tuo luettelo Excelistä tai lisää käsin.
                    </td>
                </tr>
            )}
            {apartments.map((apt) => (
              <tr key={apt.id} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                <td style={{ padding: '16px 24px', fontWeight: '700' }}>{apt.apartment_number}</td>
                <td style={{ padding: '16px 24px' }}>{apt.owner_name}</td>
                <td style={{ padding: '16px 24px', textAlign: 'right' }}>{apt.monthly_fee.toLocaleString('fi-FI')} €</td>
                <td style={{ padding: '16px 24px', textAlign: 'right', fontFamily: 'monospace', opacity: 0.8 }}>{apt.reference_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card-glass" style={{ marginTop: '32px', padding: '20px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
          <h4 style={{ color: 'var(--blue-400)', marginBottom: '8px' }}>💡 Vinkki Massatuontiin</h4>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Excel-tiedoston tulee olla CSV-muodossa ja sisältää sarakkeet tässä järjestyksessä: <br/>
              <b>Numero; Omistaja; Vastike; Viitenumero</b> (erottimena puolipiste <code>;</code>)
          </p>
      </div>
    </div>
  );
}
