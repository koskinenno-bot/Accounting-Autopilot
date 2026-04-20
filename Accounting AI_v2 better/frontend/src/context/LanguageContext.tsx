"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { translations, Language } from '@/lib/translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (path: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>('fi');

  // Load language from localStorage on mount
  useEffect(() => {
    const savedLang = localStorage.getItem('app_language') as Language;
    if (savedLang && (savedLang === 'fi' || savedLang === 'en')) {
      setLanguageState(savedLang);
    } else {
      const browserLang = navigator.language.split('-')[0];
      if (browserLang === 'fi' || browserLang === 'en') {
        setLanguageState(browserLang as Language);
      }
    }
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('app_language', lang);
  };

  const t = (path: string): string => {
    const keys = path.split('.');
    let result: any = translations[language];
    
    for (const key of keys) {
      if (result[key] === undefined) {
        // Fallback to English if key missing in current language
        let fallback: any = translations['en'];
        for (const fKey of keys) {
            if (fallback[fKey] === undefined) return path;
            fallback = fallback[fKey];
        }
        return fallback;
      }
      result = result[key];
    }
    
    return result;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
