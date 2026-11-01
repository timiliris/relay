import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/stores/settings';
import { Composer } from './composer';

const snippets = [
  {
    id: '1',
    trigger: 'résume',
    title: 'Résumer',
    body: 'Résume en cinq points :\n\n{{selection}}',
    position: 0,
  },
  {
    id: '2',
    trigger: 'traduis',
    title: 'Traduire',
    body: 'Traduis en anglais :\n\n{{selection}}',
    position: 1,
  },
  { id: '3', trigger: 'bref', title: 'Bref', body: 'Réponds en une phrase.', position: 2 },
];

function setup() {
  const onSend = vi.fn();
  render(<Composer streaming={false} onSend={onSend} onStop={() => {}} />);
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
  return { onSend, textarea };
}

describe('menu des raccourcis dans le composeur', () => {
  beforeEach(() => {
    useSettings.setState({ snippets, snippetsSeeded: true });
  });

  it('filtre au fil de la frappe et insère le corps avec Entrée', async () => {
    const { textarea, onSend } = setup();
    fireEvent.change(textarea, { target: { value: '/' } });
    expect(screen.getAllByRole('option')).toHaveLength(3);

    fireEvent.change(textarea, { target: { value: '/tr' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('/traduis');

    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(textarea.value).toBe('Traduis en anglais :'));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('navigue avec les flèches et insère la sélection tapée après le déclencheur', async () => {
    const { textarea } = setup();
    fireEvent.change(textarea, { target: { value: '/ un texte à traiter' } });
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(textarea.value).toBe('Traduis en anglais :\n\nun texte à traiter'));
  });

  it('se ferme avec Échap et laisse Entrée envoyer le texte développé', async () => {
    const { textarea, onSend } = setup();
    fireEvent.change(textarea, { target: { value: '/bref pourquoi ?' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith('Réponds en une phrase.\n\npourquoi ?', []);
    expect(textarea.value).toBe('');
  });

  it('envoie tel quel un déclencheur inconnu', async () => {
    const { textarea, onSend } = setup();
    fireEvent.change(textarea, { target: { value: '/inconnu test' } });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('/inconnu test', []));
  });

  it('insère au clic sur une entrée', async () => {
    const { textarea } = setup();
    fireEvent.change(textarea, { target: { value: '/ré' } });
    fireEvent.mouseDown(screen.getByRole('option'));
    await waitFor(() => expect(textarea.value).toBe('Résume en cinq points :'));
  });
});
