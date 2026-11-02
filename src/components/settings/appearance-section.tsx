import { Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { type Accent, useSettings } from '@/stores/settings';
import { LanguageToggle } from '../language-toggle';
import { ThemeToggle } from '../theme-toggle';
import { Segmented } from '../ui/segmented';
import { Row, SettingsSection } from './primitives';

const ACCENTS: Accent[] = ['neutral', 'violet', 'blue', 'green', 'amber', 'rose'];

function accentSwatch(accent: Accent): string {
  switch (accent) {
    case 'violet':
      return 'oklch(0.6 0.2 295)';
    case 'blue':
      return 'oklch(0.6 0.18 255)';
    case 'green':
      return 'oklch(0.6 0.15 150)';
    case 'amber':
      return 'oklch(0.75 0.16 70)';
    case 'rose':
      return 'oklch(0.65 0.19 10)';
    default:
      return 'oklch(0.5 0 0)';
  }
}

const accentKey = (accent: Accent) =>
  `settings.accent${accent.charAt(0).toUpperCase()}${accent.slice(1)}` as 'settings.accentNeutral';

/** Thème, langue, taille du texte, densité et couleur d'accent. */
export function AppearanceSection() {
  const { t } = useTranslation();
  const settings = useSettings();

  return (
    <SettingsSection
      id="appearance"
      icon={Palette}
      title={t('settings.appearance')}
      description={t('settings.appearanceHelp')}
    >
      <Row label={t('theme.label')}>
        <ThemeToggle />
      </Row>
      <Row label={t('language.label')}>
        <LanguageToggle />
      </Row>
      <Row label={t('settings.fontSize')}>
        <Segmented
          label={t('settings.fontSize')}
          value={settings.fontSize}
          onChange={(v) => settings.patch({ fontSize: v })}
          options={[
            { value: 'sm', label: t('settings.fontSm') },
            { value: 'md', label: t('settings.fontMd') },
            { value: 'lg', label: t('settings.fontLg') },
          ]}
        />
      </Row>
      <Row label={t('settings.density')}>
        <Segmented
          label={t('settings.density')}
          value={settings.density}
          onChange={(v) => settings.patch({ density: v })}
          options={[
            { value: 'comfortable', label: t('settings.densityComfortable') },
            { value: 'compact', label: t('settings.densityCompact') },
          ]}
        />
      </Row>
      <Row label={t('settings.accent')} hint={t(accentKey(settings.accent))}>
        <div role="radiogroup" aria-label={t('settings.accent')} className="flex gap-1.5">
          {ACCENTS.map((accent) => (
            <button
              key={accent}
              type="button"
              role="radio"
              aria-checked={settings.accent === accent}
              aria-label={t(accentKey(accent))}
              title={t(accentKey(accent))}
              onClick={() => settings.patch({ accent })}
              className={cn(
                'size-6 rounded-full border-2 transition-transform focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                settings.accent === accent
                  ? 'scale-110 border-foreground'
                  : 'border-transparent hover:scale-105',
              )}
              style={{ background: accentSwatch(accent) }}
            />
          ))}
        </div>
      </Row>
    </SettingsSection>
  );
}
