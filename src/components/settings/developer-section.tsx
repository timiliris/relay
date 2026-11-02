import { ShieldAlert, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_AUTO_COMMANDS } from '@/lib/agent/tools';
import type { ApprovalPolicy } from '@/lib/agent/types';
import { useSettings } from '@/stores/settings';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Segmented } from '../ui/segmented';
import { Textarea } from '../ui/textarea';
import { Field, Group, Row, SettingsSection } from './primitives';

/** Mode agent : politique d'approbation, délai des commandes, commandes auto-approuvées. */
export function DeveloperSection() {
  const { t } = useTranslation();
  const settings = useSettings();

  return (
    <SettingsSection
      id="developer"
      icon={Wrench}
      title={t('settings.developer.title')}
      description={t('settings.developer.help')}
    >
      <Group title={t('settings.developer.approval')}>
        <Segmented<ApprovalPolicy>
          label={t('settings.developer.approval')}
          value={settings.agentApproval}
          onChange={(v) => settings.patch({ agentApproval: v })}
          options={[
            { value: 'ask', label: t('settings.developer.approvalAsk') },
            { value: 'autoRead', label: t('settings.developer.approvalAutoRead') },
            { value: 'autoAll', label: t('settings.developer.approvalAutoAll') },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {t(`settings.developer.approvalHint.${settings.agentApproval}`)}
        </p>
        {settings.agentApproval === 'autoAll' && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t('settings.developer.autoAllWarning')}
          </div>
        )}
      </Group>

      <Group title={t('settings.developer.commands')}>
        <Row label={t('settings.developer.timeout')} hint={t('settings.developer.timeoutHint')}>
          <Input
            type="number"
            min={5}
            max={600}
            step={5}
            className="h-8 w-28"
            value={settings.agentCommandTimeout}
            onChange={(e) =>
              settings.patch({
                agentCommandTimeout: Math.min(600, Math.max(5, Number(e.target.value) || 120)),
              })
            }
          />
        </Row>
        <Field
          label={t('settings.developer.autoCommands')}
          hint={t('settings.developer.autoCommandsHint')}
        >
          <Textarea
            value={settings.agentAutoCommands.join('\n')}
            onChange={(e) =>
              settings.patch({
                agentAutoCommands: e.target.value
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
              })
            }
            spellCheck={false}
            className="min-h-32 text-xs"
          />
        </Field>
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => settings.patch({ agentAutoCommands: [...DEFAULT_AUTO_COMMANDS] })}
          >
            {t('settings.developer.restoreCommands')}
          </Button>
        </div>
      </Group>
    </SettingsSection>
  );
}
