import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '@/lib/agent/commands';
import { invalidateWorkspaceFiles } from '@/lib/agent/mentions';
import { useExplorer } from '@/stores/explorer';
import { useToasts } from '@/stores/toast';
import { Composer } from './composer';

const { listFiles, readFile } = vi.hoisted(() => ({
  listFiles: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('@/lib/agent/commands', () => ({
  agentCommands: { listFiles, readFile },
}));

const entries: FileEntry[] = [
  { path: 'src', kind: 'dir', size: null },
  { path: 'README.md', kind: 'file', size: 120 },
  { path: 'src/composer.tsx', kind: 'file', size: 2_400 },
  { path: 'src/lib/db.ts', kind: 'file', size: 900 },
  { path: 'logo.png', kind: 'file', size: 48_000 },
  { path: 'dump.bin', kind: 'file', size: 20 * 1024 * 1024 },
];

const WORKSPACE = 'C:\\ws';

function setup(workspace: string | null = WORKSPACE) {
  const onSend = vi.fn();
  render(<Composer streaming={false} onSend={onSend} onStop={() => {}} workspace={workspace} />);
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
  return { onSend, textarea };
}

describe('mentions @ dans le composeur', () => {
  beforeEach(() => {
    invalidateWorkspaceFiles();
    useExplorer.setState({ attachRequests: [] });
    useToasts.setState({ toasts: [] });
    listFiles.mockReset().mockResolvedValue({ entries, truncated: false });
    readFile.mockReset().mockImplementation(async (_ws: string, path: string) => {
      if (path.endsWith('.png')) throw { kind: 'tool', code: null, message: 'binary file' };
      return { content: `contenu de ${path}`, totalLines: 1, truncated: false };
    });
  });

  it('ouvre le menu sur @, filtre au fil de la frappe et joint le fichier avec Entrée', async () => {
    const { textarea, onSend } = setup();
    fireEvent.change(textarea, { target: { value: '@' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(5));
    expect(listFiles).toHaveBeenCalledWith(WORKSPACE, '.', 3);

    fireEvent.change(textarea, { target: { value: 'regarde @comp' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('composer.tsx');

    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(textarea.value).toBe('regarde @src/composer.tsx ');
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(screen.getByText('src/composer.tsx')).toBeInTheDocument());
    expect(readFile).toHaveBeenCalledWith(WORKSPACE, 'src/composer.tsx', 1, 400);
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith('regarde @src/composer.tsx', [
      expect.objectContaining({
        kind: 'text',
        name: 'src/composer.tsx',
        mime: 'text/plain',
        text: 'contenu de src/composer.tsx',
      }),
    ]);
  });

  it('navigue avec les flèches et se ferme avec Échap', async () => {
    const { textarea, onSend } = setup();
    fireEvent.change(textarea, { target: { value: '@d' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    // Préfixe du nom (dump.bin, db.ts ; chemin court d'abord) avant la sous-chaîne (README.md).
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'dump.bin',
      'db.tssrc/lib/',
      'README.md',
    ]);
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('@d', []));
  });

  it('ne réagit pas sans dossier de travail ni dans une adresse', async () => {
    const { textarea } = setup(null);
    fireEvent.change(textarea, { target: { value: '@' } });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(listFiles).not.toHaveBeenCalled();
  });

  it('refuse un binaire ou un fichier trop gros par un toast', async () => {
    const { textarea } = setup();
    fireEvent.change(textarea, { target: { value: '@logo' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    fireEvent.mouseDown(screen.getByRole('option'));
    await waitFor(() =>
      expect(useToasts.getState().toasts.map((t) => t.message)).toContain(
        'logo.png : fichier binaire, impossible à joindre.',
      ),
    );

    fireEvent.change(textarea, { target: { value: '@dump' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() =>
      expect(useToasts.getState().toasts.map((t) => t.message)).toContain(
        'dump.bin dépasse 10 Mo.',
      ),
    );
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('joint le fichier demandé par le volet Fichiers', async () => {
    const { textarea, onSend } = setup();
    useExplorer.getState().requestAttach('src/lib/db.ts', 900);
    await waitFor(() => expect(screen.getByText('src/lib/db.ts')).toBeInTheDocument());
    expect(useExplorer.getState().attachRequests).toEqual([]);

    fireEvent.change(textarea, { target: { value: 'vois ce fichier' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith('vois ce fichier', [
        expect.objectContaining({ name: 'src/lib/db.ts', text: 'contenu de src/lib/db.ts' }),
      ]),
    );
  });
});
