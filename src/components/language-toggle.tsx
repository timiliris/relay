import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/hooks/use-language';
import type { LanguageSetting } from '@/i18n';
import { Button } from './ui/button';

const order: LanguageSetting[] = ['system', 'fr', 'en'];

export function LanguageToggle() {
  const { t } = useTranslation();
  const { language, setLanguage, resolved } = useLanguage();
  const label = `${t('language.label')} : ${t(`language.${language}`)}`;

  const next = () => {
    const index = order.indexOf(language);
    setLanguage(order[(index + 1) % order.length] ?? 'system');
  };

  return (
    <Button variant="ghost" size="sm" onClick={next} aria-label={label} title={label}>
      <Languages />
      <span className="font-mono text-xs uppercase">{resolved}</span>
    </Button>
  );
}
