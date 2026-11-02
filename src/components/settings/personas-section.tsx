import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeTextFile } from '@tauri-apps/plugin-fs';
import {
  Brain,
  Ellipsis,
  FileDown,
  FileUp,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveLanguage } from '@/i18n';
import {
  CardError,
  cardFromPreset,
  parseCharacterCard,
  presetFromCard,
  serializeCard,
} from '@/lib/character-card';
import { newId, type Preset } from '@/lib/db';
import { defaultPersona } from '@/lib/persona';
import { errorMessage, isTauri } from '@/lib/tauri';
import { useConversations } from '@/stores/conversations';
import { dialog } from '@/stores/dialog';
import { usePersonaMemory } from '@/stores/persona-memory';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { PersonaEditor } from '../persona-editor';
import { PresetAvatar, PresetBadges } from '../preset-avatar';
import { Button } from '../ui/button';
import { Dropdown, DropdownItem } from '../ui/dropdown';
import { SettingsSection } from './primitives';

function blankPreset(): Preset {
  return {
    id: newId(),
    name: '',
    systemPrompt: null,
    model: null,
    temperature: null,
    topP: null,
    maxTokens: null,
    reasoning: null,
    persona: defaultPersona(),
    position: Date.now(),
    createdAt: new Date().toISOString(),
  };
}

/** Liste des personas, éditeur, import/export de fiches et packs (défauts, 18+). */
export function PersonasSection() {
  const { t } = useTranslation();
  const inTauri = isTauri();
  const settings = useSettings();
  const conversations = useConversations();
  const [editing, setEditing] = useState<Preset | null>(null);
  const memoryCounts = usePersonaMemory((s) => s.counts);
  const loadMemoryCounts = usePersonaMemory((s) => s.loadCounts);

  useEffect(() => {
    void loadMemoryCounts();
  }, [loadMemoryCounts]);

  const savePreset = async (preset: Preset) => {
    await conversations.savePreset(preset);
    setEditing(null);
    toast.success(t('presets.saved'));
  };

  const removePreset = async (preset: Preset) => {
    const ok = await dialog.confirm({
      title: t('common.delete'),
      message: t('presets.deleteConfirm', { name: preset.name }),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (ok) await conversations.removePreset(preset.id);
  };

  const addAdultPresets = async () => {
    if (!settings.adultConfirmed) {
      const ok = await dialog.confirm({
        title: t('presets.matureConfirmTitle'),
        message: t('presets.matureConfirmBody'),
        confirmLabel: t('presets.matureConfirmYes'),
      });
      if (!ok) return;
      settings.patch({ adultConfirmed: true });
    }
    const count = await conversations.addAdultPresets();
    toast.success(t('presets.adultAdded', { count }));
  };

  const importCard = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: t('presets.cardFilter'), extensions: ['json', 'png'] }],
      });
      if (typeof path !== 'string') return;
      const bytes = await readFile(path);
      const input = path.toLowerCase().endsWith('.png') ? bytes : new TextDecoder().decode(bytes);
      const card = parseCharacterCard(input);
      setEditing(presetFromCard(card, blankPreset(), resolveLanguage(settings.language)));
      toast.info(t('presets.imported', { name: card.data.name }));
    } catch (err) {
      toast.error(
        err instanceof CardError
          ? t(`presets.cardErrors.${err.code}`)
          : t('presets.importError', { detail: errorMessage(err) }),
      );
    }
  };

  const exportCard = async (preset: Preset) => {
    try {
      const slug =
        preset.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/gi, '-') || 'persona';
      const path = await save({
        defaultPath: `${slug}.card.json`,
        filters: [{ name: t('presets.cardFilter'), extensions: ['json'] }],
      });
      if (!path) return;
      await writeTextFile(path, serializeCard(cardFromPreset(preset)));
      toast.success(t('presets.exported'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const fromCurrent = () =>
    setEditing({
      ...blankPreset(),
      model: settings.defaultModel,
      systemPrompt: settings.systemPrompt || null,
      temperature: settings.temperature,
      topP: settings.topP,
      maxTokens: settings.maxTokens,
      reasoning: settings.reasoning,
    });

  return (
    <SettingsSection
      id="presets"
      icon={UserRound}
      title={t('presets.title')}
      description={t('presets.description')}
      contentClassName="gap-3"
    >
      {conversations.presets.length === 0 && !editing && (
        <p className="text-muted-foreground">{t('presets.none')}</p>
      )}
      <ul className="flex flex-col divide-y">
        {conversations.presets.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2">
            <PresetAvatar preset={p} className="size-8 text-xs" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium">{p.name}</p>
                <PresetBadges preset={p} />
                {(memoryCounts[p.id] ?? 0) > 0 && (
                  <span
                    className="inline-flex items-center gap-1 rounded-md border border-chart-1/40 bg-chart-1/10 px-1.5 py-0.5 font-mono text-xs text-chart-1"
                    title={t('presets.memory.title')}
                  >
                    <Brain className="size-3" aria-hidden="true" />
                    {t('presets.memory.count', { count: memoryCounts[p.id] ?? 0 })}
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {[
                  p.model,
                  p.systemPrompt,
                  p.persona.mode === 'innerVoice'
                    ? p.persona.innerVoice.character
                    : p.persona.roleplay.character,
                ]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
              {t('common.edit')}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('presets.exportCard')}
              title={t('presets.exportCard')}
              disabled={!inTauri}
              onClick={() => void exportCard(p)}
            >
              <FileDown />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              aria-label={t('presets.delete')}
              onClick={() => void removePreset(p)}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>

      {editing ? (
        <PersonaEditor
          preset={editing}
          onChange={setEditing}
          onSave={() => void savePreset(editing)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setEditing(blankPreset())}>
            <Plus />
            {t('presets.new')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!inTauri}
            title={inTauri ? undefined : t('common.onlyInApp')}
            onClick={() => void importCard()}
          >
            <FileUp />
            {t('presets.importCard')}
          </Button>
          <Dropdown
            align="start"
            className="w-72 p-1"
            trigger={({ toggle }) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={toggle}
                aria-label={t('settings.moreActions')}
                title={t('settings.moreActions')}
              >
                <Ellipsis />
                {t('settings.moreActions')}
              </Button>
            )}
          >
            {(close) => (
              <>
                <DropdownItem
                  onClick={() => {
                    close();
                    fromCurrent();
                  }}
                >
                  <Save />
                  {t('presets.saveFromCurrent')}
                </DropdownItem>
                <DropdownItem
                  onClick={() => {
                    close();
                    void conversations
                      .restoreDefaultPresets()
                      .then((count) => toast.success(t('presets.restored', { count })));
                  }}
                >
                  <RotateCcw />
                  {t('presets.restoreDefaults')}
                </DropdownItem>
                <DropdownItem
                  destructive
                  title={t('presets.addAdultHint')}
                  onClick={() => {
                    close();
                    void addAdultPresets();
                  }}
                >
                  <ShieldAlert />
                  {t('presets.addAdult')}
                </DropdownItem>
              </>
            )}
          </Dropdown>
        </div>
      )}
    </SettingsSection>
  );
}
