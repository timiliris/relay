import { Dices, LoaderCircle, UserPen, VenetianMask } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Preset } from '@/lib/db';
import { type DiceRoll, formatDice, parseDice, rollDice, STANDARD_DICE } from '@/lib/dice';
import { errorMessage } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { Button } from './ui/button';
import { Dropdown, DropdownItem } from './ui/dropdown';
import { Input } from './ui/input';
import { IconButton } from './ui/tooltip-button';

interface RoleplayToolsProps {
  preset: Preset;
  disabled?: boolean | undefined;
  /** Bascule « hors rôle » : le prochain envoi est préfixé par « (HRP) ». */
  ooc: boolean;
  onToggleOoc: () => void;
  /** Demande au modèle la réplique du joueur ; absent sans conversation ouverte. */
  onImpersonate?: (() => Promise<string>) | undefined;
  /** Place un texte dans la zone de saisie (remplace tout). */
  onReplaceDraft: (text: string) => void;
  /** Ajoute un texte à la fin de la zone de saisie. */
  onInsert: (text: string) => void;
}

/** Outils du composeur en mode jeu de rôle : hors rôle, « Jouer mon tour » et jets de dés. */
export function RoleplayTools({
  preset,
  disabled,
  ooc,
  onToggleOoc,
  onImpersonate,
  onReplaceDraft,
  onInsert,
}: RoleplayToolsProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const user = preset.persona.roleplay.userName.trim() || t('chat.rp.yourCharacter');

  const impersonate = async () => {
    if (!onImpersonate || busy) return;
    setBusy(true);
    try {
      const line = await onImpersonate();
      if (line) onReplaceDraft(line);
      else toast.info(t('chat.rp.impersonateEmpty'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const insertRoll = (roll: DiceRoll) => {
    const modifier =
      roll.modifier === 0 ? '' : ` ${roll.modifier > 0 ? '+' : '−'} ${Math.abs(roll.modifier)}`;
    onInsert(
      t('chat.rp.diceResult', {
        notation: formatDice(roll),
        rolls: roll.rolls.join(', '),
        modifier,
        total: roll.total,
      }),
    );
  };

  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      role="group"
      aria-label={t('chat.rp.tools')}
    >
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={ooc}
        title={t('chat.rp.oocTitle')}
        onClick={onToggleOoc}
        disabled={disabled}
        className={cn('h-8 gap-1.5 px-2', ooc ? 'bg-info/10 text-info' : 'text-muted-foreground')}
      >
        <VenetianMask className="size-4" />
        <span className="text-xs font-semibold">{t('chat.rp.ooc')}</span>
      </Button>
      {onImpersonate && (
        <IconButton
          label={busy ? t('chat.rp.impersonating') : t('chat.rp.impersonateTitle', { user })}
          className="size-8 text-muted-foreground"
          onClick={() => void impersonate()}
          disabled={disabled || busy}
          aria-busy={busy}
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <UserPen className="size-4" />}
        </IconButton>
      )}
      <DiceMenu disabled={disabled} onRoll={insertRoll} />
    </div>
  );
}

function DiceMenu({
  disabled,
  onRoll,
}: {
  disabled?: boolean | undefined;
  onRoll: (roll: DiceRoll) => void;
}) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState('');
  const [invalid, setInvalid] = useState(false);

  const rollCustom = (close: () => void) => (e: FormEvent) => {
    e.preventDefault();
    const spec = parseDice(custom);
    if (!spec) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onRoll(rollDice(spec));
    close();
  };

  return (
    <Dropdown
      align="start"
      side="top"
      className="w-60 p-2"
      trigger={({ open, toggle }) => (
        <IconButton
          label={t('chat.rp.dice')}
          className="size-8 text-muted-foreground"
          onClick={toggle}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Dices className="size-4" />
        </IconButton>
      )}
    >
      {(close) => (
        <>
          <div className="grid grid-cols-4 gap-1">
            {STANDARD_DICE.map((sides) => (
              <DropdownItem
                key={sides}
                className="justify-center font-mono text-xs"
                onClick={() => {
                  onRoll(rollDice({ count: 1, sides, modifier: 0 }));
                  close();
                }}
              >
                {t('chat.rp.diceStandard', { sides })}
              </DropdownItem>
            ))}
          </div>
          <form onSubmit={rollCustom(close)} className="mt-2 flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              <Input
                value={custom}
                onChange={(e) => {
                  setCustom(e.target.value);
                  setInvalid(false);
                }}
                placeholder={t('chat.rp.diceCustom')}
                aria-label={t('chat.rp.diceCustom')}
                aria-invalid={invalid || undefined}
                className="h-8 font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
              />
              <Button type="submit" size="sm" variant="secondary" disabled={!custom.trim()}>
                {t('chat.rp.diceRoll')}
              </Button>
            </div>
            {invalid && (
              <p className="text-xs text-destructive" role="alert">
                {t('chat.rp.diceInvalid')}
              </p>
            )}
          </form>
        </>
      )}
    </Dropdown>
  );
}
