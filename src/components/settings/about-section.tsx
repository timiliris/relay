import { BookOpen, ExternalLink, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { openExternal } from '@/lib/open-external';
import { Button } from '../ui/button';
import { SettingsSection } from './primitives';

/** Version, liens vers la documentation et le dépôt. */
export function AboutSection() {
  const { t } = useTranslation();
  return (
    <SettingsSection
      id="about"
      icon={Info}
      title={t('settings.about')}
      description={`${t('settings.version', { version: __APP_VERSION__ })} · ${t('app.tagline')}`}
      contentClassName="flex-row flex-wrap items-center gap-2"
    >
      <Button
        variant="outline"
        size="sm"
        onClick={() => openExternal('https://openrouter.ai/docs')}
      >
        <BookOpen />
        {t('settings.docs')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => openExternal('https://github.com/timiliris/relay/releases')}
      >
        <ExternalLink />
        {t('settings.repo')}
      </Button>
    </SettingsSection>
  );
}
