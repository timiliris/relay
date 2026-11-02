import { render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CodeEditor, detectLanguage, detectLineEnding } from './code-editor';

describe('detectLanguage', () => {
  it.each([
    ['src/main.ts', 'typescript'],
    ['src/App.TSX', 'tsx'],
    ['lib/index.mjs', 'javascript'],
    ['components/Card.jsx', 'jsx'],
    ['src-tauri/src/main.rs', 'rust'],
    ['package.json', 'json'],
    ['tsconfig.jsonc', 'json'],
    ['README.md', 'markdown'],
    ['docs/page.mdx', 'markdown'],
    ['styles/globals.css', 'css'],
    ['index.html', 'html'],
    ['scripts/build.py', 'python'],
    ['.github/workflows/ci.yml', 'yaml'],
    ['config.yaml', 'yaml'],
  ])('%s → %s', (path, expected) => {
    expect(detectLanguage(path)).toBe(expected);
  });

  it('retombe sur le texte brut sans extension connue', () => {
    expect(detectLanguage('LICENSE')).toBe('plain');
    expect(detectLanguage('.gitignore')).toBe('plain');
    expect(detectLanguage('Cargo.toml')).toBe('plain');
    expect(detectLanguage('archive.tar.gz')).toBe('plain');
  });

  it('ne confond pas un dossier à point avec une extension', () => {
    expect(detectLanguage('.config/app')).toBe('plain');
    expect(detectLanguage('a.b/notes.md')).toBe('markdown');
  });
});

describe('detectLineEnding', () => {
  it('détecte LF', () => {
    expect(detectLineEnding('a\nb\nc\n')).toBe('LF');
  });

  it('détecte CRLF', () => {
    expect(detectLineEnding('a\r\nb\r\nc\r\n')).toBe('CRLF');
  });

  it('retient la fin de ligne majoritaire', () => {
    expect(detectLineEnding('a\r\nb\r\nc\nd')).toBe('CRLF');
    expect(detectLineEnding('a\nb\nc\r\nd')).toBe('LF');
  });

  it('vaut LF par défaut sans retour à la ligne', () => {
    expect(detectLineEnding('')).toBe('LF');
    expect(detectLineEnding('une seule ligne')).toBe('LF');
  });
});

describe('CodeEditor', () => {
  beforeAll(() => {
    // jsdom ne mesure rien : CodeMirror a besoin de ces méthodes pour se dessiner.
    const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
    Range.prototype.getBoundingClientRect = () => rect() as DOMRect;
    Range.prototype.getClientRects = () =>
      ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as DOMRectList;
  });

  it("affiche le contenu grisé pendant le chargement, puis l'éditeur CodeMirror", async () => {
    render(<CodeEditor value={'const a = 1;\nconst b = 2;'} onChange={vi.fn()} path="demo.ts" />);

    // Barre d'état disponible dès le départ.
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText('LF')).toBeInTheDocument();
    expect(screen.getByText('UTF-8')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId('code-editor')).toBeInTheDocument());
    await waitFor(() =>
      expect(document.querySelector('.cm-editor .cm-content')).toHaveTextContent('const a = 1;'),
    );
    expect(
      document.querySelectorAll('.cm-gutter.cm-lineNumbers .cm-gutterElement').length,
    ).toBeGreaterThan(1);
  });

  it('affiche CRLF et le texte brut pour un fichier inconnu', () => {
    render(<CodeEditor value={'a\r\nb'} onChange={vi.fn()} path="NOTES" />);
    expect(screen.getByText('CRLF')).toBeInTheDocument();
    expect(screen.getByText('Texte brut')).toBeInTheDocument();
  });
});
