import { Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProviderSort } from '@/lib/openrouter';
import { useSettings } from '@/stores/settings';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Switch } from '../ui/switch';
import { Field, Row, SettingsSection } from './primitives';

/** Options de routage OpenRouter, appliquées à toutes les requêtes. */
export function RoutingSection() {
  const { t } = useTranslation();
  const settings = useSettings();

  return (
    <SettingsSection
      id="routing"
      icon={Route}
      title={t('settings.routing')}
      description={t('settings.routingHelp')}
    >
      <Row label={t('settings.providerSort')}>
        <Select
          value={settings.providerSort ?? ''}
          onChange={(e) =>
            settings.patch({ providerSort: (e.target.value || null) as ProviderSort | null })
          }
          aria-label={t('settings.providerSort')}
        >
          <option value="">{t('settings.sortNone')}</option>
          <option value="price">{t('settings.sortPrice')}</option>
          <option value="throughput">{t('settings.sortThroughput')}</option>
          <option value="latency">{t('settings.sortLatency')}</option>
        </Select>
      </Row>
      <Field label={t('settings.ignoreProviders')}>
        <Input
          value={settings.ignoreProviders.join(', ')}
          onChange={(e) =>
            settings.patch({
              ignoreProviders: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder={t('settings.ignoreProvidersPlaceholder')}
          className="h-8"
        />
      </Field>
      <Row label={t('settings.dataCollectionDeny')} hint={t('settings.dataCollectionDenyHint')}>
        <Switch
          checked={settings.dataCollectionDeny}
          onCheckedChange={(v) => settings.patch({ dataCollectionDeny: v })}
          aria-label={t('settings.dataCollectionDeny')}
        />
      </Row>
    </SettingsSection>
  );
}
