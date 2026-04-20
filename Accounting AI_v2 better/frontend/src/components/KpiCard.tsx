export default function KpiCard({ title, value, type = 'neutral' }: { title: string, value: string | number, type?: 'positive' | 'negative' | 'neutral' }) {
  let color = 'var(--text-primary)';
  if (type === 'positive') color = 'var(--green-500)';
  if (type === 'negative') color = 'var(--red-500)';

  return (
    <div className="card-glass" style={{ padding: '24px', flex: 1 }}>
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '8px', fontWeight: '500' }}>
        {title}
      </p>
      <h3 style={{ fontSize: '32px', color, fontWeight: '700' }}>
        {value}
      </h3>
    </div>
  );
}
