import { Link, useNavigate } from '@tanstack/react-router';
import { Check, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { applyPreset } from '@/lib/chat-service';
import type { Conversation, Preset } from '@/lib/db';
import { errorMessage } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { useConversations } from '@/stores/conversations';
import { toast } from '@/stores/toast';
import { PresetAvatar, PresetBadges } from './preset-avatar';
import { Button } from './ui/button';
import { Dropdown, DropdownItem } from './ui/dropdown';

interface PresetPickerProps {
  conversation: Conversation | null;
}

/**
 * Applique un persona (instruction composée, modèle, paramètres) à la conversation ou aux
 * défauts ; un persona en jeu de rôle ouvre une conversation avec sa première réplique.
 */
export function PresetPicker({ conversation }: PresetPickerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const presets = useConversations((s) => s.presets);
  const current = presets.find((p) => p.id === conversation?.presetId);

  const apply = async (preset: Preset) => {
    try {
      const created = await applyPreset(conversation, preset);
      if (created) {
        toast.success(t('presets.started', { name: preset.name }));
        await navigate({ to: '/chat/$conversationId', params: { conversationId: created.id } });
      } else {
        toast.success(t('presets.applied', { name: preset.name }));
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Dropdown
      align="start"
      side="top"
      className="w-72 p-1"
      trigger={({ toggle }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          aria-label={t('presets.apply')}
          title={current?.name ?? t('presets.apply')}
          className={cn('gap-1.5 text-muted-foreground', current && 'text-primary')}
        >
          {current ? (
            <PresetAvatar preset={current} className="size-4 text-[9px]" />
          ) : (
            <UserRound className="size-4" />
          )}
          <span className="hidden max-w-28 truncate text-xs lg:inline">
            {current?.name ?? t('presets.apply')}
          </span>
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
              <PresetAvatar preset={p} className="size-5 text-[10px]" />
              <span className="flex-1 truncate">{p.name}</span>
              <PresetBadges preset={p} />
              {current?.id === p.id && <Check className="text-primary" />}
            </DropdownItem>
          ))}
        </>
      )}
    </Dropdown>
  );
}
