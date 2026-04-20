import { useState, useEffect } from 'react';
import { fetchWithAuth } from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';

interface ActivityReportSection {
  title: string;
  body: string;
}

interface ActivityContent {
  sections: ActivityReportSection[];
}

export default function ActivityReportEdit({ companyId, year }: { companyId: number, year: number }) {
  const { t } = useLanguage();
  
  const DEFAULT_SECTIONS: ActivityReportSection[] = [
    { title: t('reports.activity.defaults.hallo'), body: t('reports.activity.defaults.halloBody') },
    { title: t('reports.activity.defaults.talous'), body: t('reports.activity.defaults.talousBody') },
    { title: t('reports.activity.defaults.remontit'), body: t('reports.activity.defaults.remontitBody') },
    { title: t('reports.activity.defaults.muut'), body: '' },
  ];

  const [sections, setSections] = useState<ActivityReportSection[]>(DEFAULT_SECTIONS);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  useEffect(() => {
    async function loadReport() {
      try {
        const res = await fetchWithAuth(`/companies/${companyId}/compliance/activity-report/${year}`);
        const data = await res.json();
        if (data && data.content_json) {
          const content: ActivityContent = JSON.parse(data.content_json);
          setSections(content.sections);
          setLastSaved(new Date(data.updated_at));
        } else {
          // If no report exists, use defaults (which are now translated)
          setSections(DEFAULT_SECTIONS);
        }
      } catch (err) {
        console.error(err);
      }
    }
    loadReport();
  }, [companyId, year, t]); // Added t to dependencies to refresh defaults on language change

  const handleSave = async () => {
    setSaving(true);
    try {
      const content: ActivityContent = { sections };
      await fetchWithAuth(`/companies/${companyId}/compliance/activity-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year,
          content_json: JSON.stringify(content)
        })
      });
      setLastSaved(new Date());
    } catch (err) {
      alert(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const updateSection = (index: number, body: string) => {
    const newSections = [...sections];
    newSections[index].body = body;
    setSections(newSections);
  };

  return (
    <div className="card-glass" style={{ padding: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ margin: 0 }}>{t('reports.activity.title')} {year}</h2>
          <p style={{ margin: '4px 0', opacity: 0.6, fontSize: '13px' }}>
            {t('reports.activity.subtitle')}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <button 
            onClick={handleSave} 
            disabled={saving}
            className="btn-primary"
            style={{ padding: '10px 24px', background: 'var(--blue-500)' }}
          >
            {saving ? t('common.saving') : t('reports.activity.save')}
          </button>
          {lastSaved && (
            <p style={{ fontSize: '11px', opacity: 0.5, marginTop: '4px' }}>
              {t('reports.activity.lastSaved')}: {lastSaved.toLocaleTimeString(t('common.locale'))}
            </p>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {sections.map((section, idx) => (
          <div key={idx}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', marginBottom: '8px', color: 'var(--blue-400)' }}>
              {section.title.toUpperCase()}
            </label>
            <textarea
              value={section.body}
              onChange={(e) => updateSection(idx, e.target.value)}
              style={{
                width: '100%',
                minHeight: '120px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--glass-border)',
                borderRadius: '8px',
                color: 'white',
                padding: '12px',
                fontSize: '15px',
                lineHeight: '1.6',
                fontFamily: 'inherit',
                resize: 'vertical'
              }}
              placeholder={`${t('reports.activity.placeholderPrefix')} ${section.title.toLowerCase()}...`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
