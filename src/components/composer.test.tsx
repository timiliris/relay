import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Preset } from '@/lib/db';
import { defaultPersona } from '@/lib/persona';
import { Composer } from './composer';

const preset = (mode: 'assistant' | 'roleplay'): Preset => ({
  id: 'p1',
  name: 'Maître du jeu',
  systemPrompt: null,
  model: null,
  temperature: null,
  topP: null,
  maxTokens: null,
  reasoning: null,
  persona: { ...defaultPersona(), mode },
  position: 0,
  createdAt: '',
});

function renderComposer(mode: 'assistant' | 'roleplay', onImpersonate?: () => Promise<string>) {
  const onSend = vi.fn();
  render(
    <Composer
      streaming={false}
      onSend={onSend}
      onStop={() => {}}
      preset={preset(mode)}
      onImpersonate={onImpersonate}
    />,
  );
  return {
    onSend,
    textarea: screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Envoyer' }),
  };
}

describe('Composer en jeu de rôle', () => {
  it("n'affiche pas les outils en mode assistant", () => {
    renderComposer('assistant');
    expect(screen.queryByRole('group', { name: 'Outils de jeu de rôle' })).not.toBeInTheDocument();
  });

  it('préfixe le message par (HRP) à l’envoi puis désactive la bascule', async () => {
    const { onSend, textarea } = renderComposer('roleplay');
    const ooc = screen.getByRole('button', { pressed: false, name: 'HRP' });
    fireEvent.click(ooc);
    expect(ooc).toHaveAttribute('aria-pressed', 'true');

    fireEvent.change(textarea, { target: { value: 'On fait une pause ?' } });
    expect(textarea).toHaveValue('On fait une pause ?');
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // L'envoi développe d'abord les raccourcis éventuels : il est asynchrone.
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('(HRP) On fait une pause ?', []));
    expect(ooc).toHaveAttribute('aria-pressed', 'false');
    expect(textarea).toHaveValue('');
  });

  it('bascule le hors rôle avec Ctrl+Maj+O', () => {
    const { textarea } = renderComposer('roleplay');
    fireEvent.keyDown(textarea, { key: 'O', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('button', { name: 'HRP' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('place la réplique proposée dans la saisie sans l’envoyer', async () => {
    const { onSend, textarea } = renderComposer('roleplay', async () => 'Je sors mon épée.');
    fireEvent.click(screen.getByRole('button', { name: /prochaine réplique/ }));
    expect(await screen.findByDisplayValue('Je sors mon épée.')).toBe(textarea);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('insère un jet de dés dans la saisie', () => {
    const { textarea } = renderComposer('roleplay');
    fireEvent.click(screen.getByRole('button', { name: 'Jets de dés' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'd6' }));
    expect(textarea.value).toMatch(/^🎲 d6 → \[[1-6]\] = [1-6]$/);
  });
});
