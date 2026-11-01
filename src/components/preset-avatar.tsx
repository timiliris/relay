import { Drama } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { hueStyle } from '@/lib/color';
import type { Preset } from '@/lib/db';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';

/** Pastille colorée stable par persona (initiale sur teinte dérivée de l'identifiant). */
export function PresetAvatar({ preset, className }: { preset: Preset; className?: string }) {
  return (
    <span
      className={cn(
        'hue-solid inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none',
        className,
      )}
      style={hueStyle(preset.id)}
      aria-hidden="true"
    >
      {preset.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/** Étiquettes « RP » et « 18+ » d'un persona ; rien pour un assistant classique. */
export function PresetBadges({ preset, className }: { preset: Preset; className?: string }) {
  const { t } = useTranslation();
  const { mode, mature } = preset.persona;
  if (mode !== 'roleplay' && !mature) return null;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1', className)}>
      {mode === 'roleplay' && (
        <Badge
          className="gap-1 border-chart-1/40 bg-chart-1/10 px-1.5 text-chart-1"
          title={t('presets.modeRoleplay')}
        >
          <Drama className="size-3" aria-hidden="true" />
          {t('presets.badgeRoleplay')}
        </Badge>
      )}
      {mature && (
        <Badge
          className="border-destructive/40 bg-destructive/10 px-1.5 font-semibold text-destructive"
          title={t('presets.mature')}
        >
          {t('presets.badgeMature')}
        </Badge>
      )}
    </span>
  );
}
