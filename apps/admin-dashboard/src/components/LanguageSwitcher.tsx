import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';

const LanguageSwitcher = () => {
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'fi' ? 'en' : 'fi';
    i18n.changeLanguage(newLang);
  };

  return (
    <button 
      onClick={toggleLanguage}
      className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-slate-100 transition-all text-xs font-semibold"
    >
      <Globe className="w-3.5 h-3.5" />
      <span>{i18n.language === 'fi' ? 'EN' : 'FI'}</span>
    </button>
  );
};

export default LanguageSwitcher;
