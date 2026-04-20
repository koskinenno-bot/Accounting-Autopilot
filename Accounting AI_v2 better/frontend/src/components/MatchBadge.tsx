import { MatchType } from '@/types';
import { useLanguage } from '@/context/LanguageContext';

export default function MatchBadge({ type }: { type: MatchType }) {
  const { t } = useLanguage();

  if (type === 'REFERENCE') {
    return <span className="badge badge-ref">🔵 {t('transactions.badge.reference')}</span>;
  }
  if (type === 'RULE') {
    return <span className="badge badge-rule">🟡 {t('transactions.badge.rule')}</span>;
  }
  if (type === 'AI') {
    return <span className="badge badge-ai">🟣 {t('transactions.badge.ai')}</span>;
  }
  if (type === 'MANUAL') {
    return <span className="badge badge-manual">⚪ {t('transactions.badge.manual')}</span>;
  }
  
  return <span className="badge badge-manual">🔴 {t('transactions.badge.unmatched')}</span>;
}
