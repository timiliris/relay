import { Link } from '@tanstack/react-router';
import { Check, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Conversation, Preset } from '@/lib/db';
import { cn } from '@/lib/utils';
import { useConversations } from '@/stores/conversations';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { Button } from './ui/button';
import { Dropdown, DropdownItem } from './ui/dropdown';

interface PresetPickerProps {
  conversation: Conversation | null;
}

/** Applique un persona (instruction système, modèle, paramètres) à la conversation ou aux défauts. */
export function PresetPicker({ conversation }: PresetPickerProps) {
  const { t } = useTranslation();
  const presets = useConversations((s) => s.presets);
  const update = useConversations((s) => s.update);
  const settings = useSettings();
  const current = presets.find((p) => p.id === conversation?.presetId);

  const apply = async (preset: Preset) => {
    if (conversation) {
      await update(conversation.id, {
        presetId: preset.id,
        systemPrompt: preset.systemPrompt,
        temperature: preset.temperature,
        topP: preset.topP,
        maxTokens: preset.maxTokens,
        reasoning: preset.reasoning,
        ...(preset.model ? { model: preset.model } : {}),
      });
    } else {
      settings.patch({
        systemPrompt: preset.systemPrompt ?? '',
        ...(preset.temperature !== null ? { temperature: preset.temperature } : {}),
        ...(preset.topP !== null ? { topP: preset.topP } : {}),
        ...(preset.maxTokens !== null ? { maxTokens: preset.maxTokens } : {}),
        ...(preset.reasoning !== null ? { reasoning: preset.reasoning } : {}),
        ...(preset.model ? { defaultModel: preset.model } : {}),
      });
    }
    toast.success(t('presets.applied', { name: preset.name }));
  };

  return (
    <Dropdown
      align="start"
      side="top"
      className="w-64 p-1"
      trigger={({ toggle }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          aria-label={t('presets.apply')}
          title={current?.name ?? t('presets.apply')}
          className={cn('gap-1.5 text-muted-foreground', current && 'text-primary')}
        >
          <UserRound className="size-4" />
          {current && <span className="max-w-28 truncate text-xs">{current.name}</span>}
        </Button>
      )}
    >
      {(close) => (
        <>
          {presets.length === 0 && (
            <div className="p-2 text-xs text-muted-foreground">
              <p>{t('presets.none')}</p>
              <Link
                to="/settings"
                hash="presets"
                className="mt-1 inline-block text-primary underline"
                onClick={close}
              >
                {t('common.settings')}
              </Link>
            </div>
          )}
          {presets.map((p) => (
            <DropdownItem
              key={p.id}
              onClick={() => {
                close();
                void apply(p);
              }}
            >
              <span className="flex-1 truncate">{p.name}</span>
              {current?.id === p.id && <Check className="text-primary" />}
            </DropdownItem>
          ))}
        </>
      )}
    </Dropdown>
  );
}
