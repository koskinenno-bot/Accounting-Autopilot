import { CompanyLoanRead } from '@/types';

export default function LoanTrackingView({ loans }: { loans: CompanyLoanRead[] }) {
  const formatEuro = (amount: number) => {
    return `€${amount.toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div style={{ padding: '0' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '800', marginBottom: '8px' }}>Laina-osuuslaskenta</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Seuraa yhtiölainojen lyhennyksiä ja huoneistokohtaisia velkaosuuksia.</p>
      </div>

      {loans.length === 0 ? (
        <div className="card-glass" style={{ padding: '40px', textAlign: 'center' }}>
          <p style={{ opacity: 0.5 }}>Ei aktiivisia yhtiölainoja seannassa.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {loans.map((loan) => (
            <div key={loan.id} className="card-glass" style={{ overflow: 'hidden' }}>
              {/* Loan Header */}
              <div style={{ padding: '24px', borderBottom: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h2 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '4px' }}>{loan.name}</h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{loan.bank_name} | Korko: {loan.interest_rate}%</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Lainan kokonaismäärä</div>
                    <div style={{ fontSize: '24px', fontWeight: '900', color: 'var(--blue-400)' }}>{formatEuro(loan.total_amount)}</div>
                  </div>
                </div>
              </div>

              {/* Apartment Shares Table */}
              <div style={{ padding: '0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.05)', textAlign: 'left', fontSize: '12px', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '12px 24px' }}>Huoneisto</th>
                      <th style={{ padding: '12px 24px', textAlign: 'right' }}>Alkuperäinen osuus</th>
                      <th style={{ padding: '12px 24px', textAlign: 'right' }}>Jäljellä oleva osuus</th>
                      <th style={{ padding: '12px 24px', textAlign: 'right' }}>Lyhennetty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loan.shares.map((share) => {
                      const reduction = share.initial_share - share.remaining_share;
                      const progress = (reduction / share.initial_share) * 100;
                      
                      return (
                        <tr key={share.id} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                          <td style={{ padding: '14px 24px', fontWeight: '700' }}>#{share.apartment_id}</td>
                          <td style={{ padding: '14px 24px', textAlign: 'right', opacity: 0.6 }}>{formatEuro(share.initial_share)}</td>
                          <td style={{ padding: '14px 24px', textAlign: 'right', fontWeight: '800', color: 'var(--text-primary)' }}>
                            {formatEuro(share.remaining_share)}
                          </td>
                          <td style={{ padding: '14px 24px', textAlign: 'right' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                              <span style={{ color: 'var(--green-400)', fontWeight: '600' }}>{formatEuro(reduction)}</span>
                              <div style={{ width: '100px', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                                <div style={{ width: `${progress}%`, height: '100%', background: 'var(--green-500)' }}></div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '32px', padding: '24px', background: 'rgba(59, 130, 246, 0.05)', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
        <h4 style={{ margin: '0 0 8px 0', color: 'var(--blue-400)' }}>⚙️ Automaatio</h4>
        <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)' }}>
          Jäljellä olevat laina-osuudet päivittyvät automaattisesti, kun vahvistat tiliotteelta 
          <strong> Rahoitusvastike (305x)</strong> -kategorian maksuja.
        </p>
      </div>
    </div>
  );
}
