"use client";

import { useLanguage } from '@/context/LanguageContext';

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <div style={{
      display: 'flex',
      gap: '4px',
      padding: '4px',
      background: 'rgba(255, 255, 255, 0.03)',
      backdropFilter: 'blur(12px)',
      borderRadius: '12px',
      border: '1px solid var(--glass-border)',
      width: 'fit-content',
      marginBottom: '20px'
    }}>
      <button
        onClick={() => setLanguage('fi')}
        style={{
          padding: '4px 8px',
          borderRadius: '6px',
          fontSize: '11px',
          fontWeight: '700',
          background: language === 'fi' ? 'var(--blue-500)' : 'transparent',
          color: language === 'fi' ? 'white' : 'rgba(255,255,255,0.4)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          cursor: 'pointer',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}
      >
        <span style={{ fontSize: '12px' }}>🇫🇮</span> FI
      </button>
      <button
        onClick={() => setLanguage('en')}
        style={{
          padding: '4px 8px',
          borderRadius: '6px',
          fontSize: '11px',
          fontWeight: '700',
          background: language === 'en' ? 'var(--blue-500)' : 'transparent',
          color: language === 'en' ? 'white' : 'rgba(255,255,255,0.4)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          cursor: 'pointer',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}
      >
        <span style={{ fontSize: '12px' }}>🇺🇸</span> EN
      </button>
    </div>
  );
}
