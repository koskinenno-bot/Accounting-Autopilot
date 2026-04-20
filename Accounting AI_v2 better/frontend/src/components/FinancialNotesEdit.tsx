import { useState, useEffect } from 'react';
import { fetchWithAuth } from '@/lib/api';

const NOTE_TYPES = [
  'Vakuudet ja vastuusitoumukset',
  'Pantatut osakkeet',
  'Henkilöstön määrä',
  'Hallituksen jäsenet ja palkkiot',
  'Tärkeimmät tapahtumat tilikauden jälkeen',
  'Muut liitetiedot'
];

export default function FinancialNotesEdit({ companyId, year }: { companyId: number, year: number }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    async function loadNotes() {
      try {
        const res = await fetchWithAuth(`/companies/${companyId}/compliance/financial-notes/${year}`);
        const data = await res.json();
        const initialNotes: Record<string, string> = {};
        data.forEach((n: any) => {
          initialNotes[n.note_type] = n.content;
        });
        setNotes(initialNotes);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadNotes();
  }, [companyId, year]);

  const handleSave = async (type: string) => {
    setSaving(type);
    try {
      await fetchWithAuth(`/companies/${companyId}/compliance/financial-notes?year=${year}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note_type: type,
          content: notes[type] || ''
        })
      });
    } catch (err) {
      alert('Tallennus epäonnistui');
    } finally {
      setSaving(null);
    }
  };

  const updateNote = (type: string, content: string) => {
    setNotes(prev => ({ ...prev, [type]: content }));
  };

  if (loading) return <div style={{ padding: '20px', opacity: 0.5 }}>Ladataan liitetietoja...</div>;

  return (
    <div className="card-glass" style={{ padding: '32px' }}>
      <h2 style={{ marginBottom: '8px' }}>Tilinpäätöksen liitetiedot {year}</h2>
      <p style={{ opacity: 0.6, fontSize: '13px', marginBottom: '32px' }}>
        Lakisääteiset PMA 1753/2015 mukaiset lisätiedot tilinpäätöksen lukijan tiedoksi.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {NOTE_TYPES.map(type => (
          <div key={type}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label style={{ fontWeight: '700', fontSize: '12px', textTransform: 'uppercase', color: 'var(--blue-400)' }}>
                {type}
              </label>
              <button 
                onClick={() => handleSave(type)}
                className="btn-tiny"
                disabled={saving === type}
                style={{ fontSize: '10px', padding: '4px 12px' }}
              >
                {saving === type ? 'Tallentaa...' : 'Tallenna osio'}
              </button>
            </div>
            <textarea 
              value={notes[type] || ''}
              onChange={(e) => updateNote(type, e.target.value)}
              style={{
                width: '100%',
                minHeight: '80px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--glass-border)',
                borderRadius: '8px',
                color: 'white',
                padding: '12px',
                fontSize: '14px',
                lineHeight: '1.5',
                fontFamily: 'inherit',
                resize: 'vertical'
              }}
              placeholder={`Kirjoita selvitys koskien osiota: ${type.toLowerCase()}...`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
