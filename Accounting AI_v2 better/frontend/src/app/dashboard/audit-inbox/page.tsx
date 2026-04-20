"use client";

import { useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import Link from 'next/link';

export default function GlobalAuditInbox() {
  const { t } = useLanguage();
  const [inbox, setInbox] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadInbox() {
      try {
        setLoading(true);
        const res = await fetchWithAuth('/audit/inbox');
        const data = await res.json();
        setInbox(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadInbox();
  }, []);

  if (loading) return <div style={{ padding: '40px' }}>{t('common.loading')}</div>;

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '800', marginBottom: '8px' }}>Global Inbox 📥</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Kaikkien hallinnoimiesi yhtiöiden tiliöimättömät tapahtumat yhdellä listalla.</p>
      </div>

      <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
        {inbox.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', opacity: 0.5 }}>
            <span style={{ fontSize: '48px' }}>🎉</span>
            <h3>Kaikki puhdasta!</h3>
            <p>Ei odottavia tiliöintejä missään yhtiössä.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid var(--glass-border)' }}>
              <tr>
                <th style={{ textAlign: 'left', padding: '16px 24px', fontSize: '12px' }}>YHTIÖ</th>
                <th style={{ textAlign: 'left', padding: '16px 24px', fontSize: '12px' }}>PVM</th>
                <th style={{ textAlign: 'left', padding: '16px 24px', fontSize: '12px' }}>KUVAUS</th>
                <th style={{ textAlign: 'right', padding: '16px 24px', fontSize: '12px' }}>SUMMA</th>
                <th style={{ textAlign: 'right', padding: '16px 24px', fontSize: '12px' }}>TOIMINTO</th>
              </tr>
            </thead>
            <tbody>
              {inbox.map((tx) => (
                <tr key={tx.id} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ fontWeight: '700', fontSize: '13px' }}>{tx.company_name}</div>
                  </td>
                  <td style={{ padding: '16px 24px', opacity: 0.7 }}>{tx.date}</td>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ fontSize: '14px' }}>{tx.description}</div>
                    {tx.iban && <div style={{ fontSize: '10px', opacity: 0.5 }}>{tx.iban}</div>}
                  </td>
                  <td style={{ padding: '16px 24px', textAlign: 'right', fontWeight: '800' }}>
                    {tx.amount.toLocaleString('fi-FI')} €
                  </td>
                  <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                    <Link href={`/dashboard/company/${tx.company_id}/audit`}>
                      <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '12px' }}>
                        Tiliöi ➔
                      </button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
