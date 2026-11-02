/**
 * Éditeur de code du volet Fichiers, fondé sur CodeMirror 6.
 *
 * Le cœur de CodeMirror (≈ 350 Ko minifiés) et chaque paquet de langage sont chargés à la demande
 * (`import()`) : rien n'alourdit le démarrage tant qu'aucun fichier n'est ouvert. Pendant le
 * chargement, le contenu est affiché dans un `<pre>` grisé.
 */
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsDark } from '@/hooks/use-is-dark';
import { cn } from '@/lib/utils';

export type EditorLanguage =
  | 'javascript'
  | 'jsx'
  | 'typescript'
  | 'tsx'
  | 'rust'
  | 'json'
  | 'markdown'
  | 'css'
  | 'html'
  | 'python'
  | 'yaml'
  | 'plain';

export type LineEnding = 'LF' | 'CRLF';

const EXTENSIONS: Record<string, EditorLanguage> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  rs: 'rust',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  css: 'css',
  html: 'html',
  htm: 'html',
  py: 'python',
  pyi: 'python',
  yml: 'yaml',
  yaml: 'yaml',
};

/** Nom affiché dans la barre d'état (le texte brut est traduit à part). */
export const LANGUAGE_LABELS: Record<Exclude<EditorLanguage, 'plain'>, string> = {
  javascript: 'JavaScript',
  jsx: 'JSX',
  typescript: 'TypeScript',
  tsx: 'TSX',
  rust: 'Rust',
  json: 'JSON',
  markdown: 'Markdown',
  css: 'CSS',
  html: 'HTML',
  python: 'Python',
  yaml: 'YAML',
};

/** Langage d'après l'extension du fichier (insensible à la casse), texte brut sinon. */
export function detectLanguage(path: string): EditorLanguage {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'plain';
  return EXTENSIONS[name.slice(dot + 1).toLowerCase()] ?? 'plain';
}

/** Fin de ligne majoritaire ; LF par défaut (fichier sans retour à la ligne compris). */
export function detectLineEnding(text: string): LineEnding {
  let crlf = 0;
  let lf = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
    else lf++;
  }
  return crlf > lf ? 'CRLF' : 'LF';
}

// ---------- Chargement paresseux ----------

interface Bundle {
  state: typeof import('@codemirror/state');
  view: typeof import('@codemirror/view');
  commands: typeof import('@codemirror/commands');
  language: typeof import('@codemirror/language');
  search: typeof import('@codemirror/search');
  autocomplete: typeof import('@codemirror/autocomplete');
  highlight: typeof import('@lezer/highlight');
}

let loadedBundle: Bundle | null = null;
let bundleLoading: Promise<Bundle> | null = null;

function loadBundle(): Promise<Bundle> {
  bundleLoading ??= Promise.all([
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@codemirror/commands'),
    import('@codemirror/language'),
    import('@codemirror/search'),
    import('@codemirror/autocomplete'),
    import('@lezer/highlight'),
  ]).then(([state, view, commands, language, search, autocomplete, highlight]) => {
    loadedBundle = { state, view, commands, language, search, autocomplete, highlight };
    return loadedBundle;
  });
  return bundleLoading;
}

const languageCache = new Map<EditorLanguage, Promise<Extension | null>>();

/** Paquet de langage, chargé dans son propre morceau de bundle et mis en cache. */
function loadLanguage(lang: EditorLanguage): Promise<Extension | null> {
  let pending = languageCache.get(lang);
  if (!pending) {
    pending = importLanguage(lang);
    languageCache.set(lang, pending);
  }
  return pending;
}

async function importLanguage(lang: EditorLanguage): Promise<Extension | null> {
  switch (lang) {
    case 'javascript':
    case 'jsx':
    case 'typescript':
    case 'tsx': {
      const { javascript } = await import('@codemirror/lang-javascript');
      return javascript({
        jsx: lang === 'jsx' || lang === 'tsx',
        typescript: lang === 'typescript' || lang === 'tsx',
      });
    }
    case 'rust':
      return (await import('@codemirror/lang-rust')).rust();
    case 'json':
      return (await import('@codemirror/lang-json')).json();
    case 'markdown': {
      const { markdown, markdownLanguage } = await import('@codemirror/lang-markdown');
      return markdown({ base: markdownLanguage });
    }
    case 'css':
      return (await import('@codemirror/lang-css')).css();
    case 'html':
      return (await import('@codemirror/lang-html')).html();
    case 'python':
      return (await import('@codemirror/lang-python')).python();
    case 'yaml':
      return (await import('@codemirror/lang-yaml')).yaml();
    case 'plain':
      return null;
  }
}

// ---------- Thème ----------

/** Couleur d'un jeton de l'app, mélangée à du transparent (`pct` en %). */
const tint = (token: string, pct: number) =>
  `color-mix(in oklch, var(--color-${token}) ${pct}%, transparent)`;

/**
 * Thème : fond transparent, jetons `--color-*` de `globals.css` (qui suivent déjà la classe
 * `dark`). Le drapeau `dark` ne sert qu'aux réglages de base de CodeMirror.
 */
function makeTheme(b: Bundle, dark: boolean): Extension {
  return b.view.EditorView.theme(
    {
      '&': {
        height: '100%',
        backgroundColor: 'transparent',
        color: 'var(--color-foreground)',
        fontSize: '12px',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': {
        height: '100%',
        fontFamily: 'var(--font-mono)',
        lineHeight: '1.6',
        overflow: 'auto',
      },
      '.cm-content': {
        caretColor: 'var(--color-foreground)',
        padding: '8px 0',
      },
      '.cm-line': { padding: '0 12px 0 6px' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-foreground)' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
        { backgroundColor: tint('info', dark ? 35 : 22) },
      '.cm-activeLine': { backgroundColor: tint('accent', 70) },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        color: 'var(--color-muted-foreground)',
        borderRight: '1px solid var(--color-border)',
        minWidth: '2.5rem',
      },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 10px' },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: 'var(--color-foreground)',
      },
      '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
        backgroundColor: tint('info', 25),
        outline: `1px solid ${tint('info', 60)}`,
      },
      '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': {
        backgroundColor: tint('destructive', 25),
      },
      '.cm-selectionMatch': { backgroundColor: tint('warning', 25) },
      '.cm-searchMatch': {
        backgroundColor: tint('warning', 35),
        outline: `1px solid ${tint('warning', 60)}`,
      },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: tint('warning', 60) },
      '.cm-specialChar': { color: 'var(--color-destructive)' },
      // Panneau de recherche (Ctrl+F).
      '.cm-panels': {
        backgroundColor: 'var(--color-card)',
        color: 'var(--color-foreground)',
        fontFamily: 'var(--font-sans)',
        fontSize: '11px',
      },
      '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--color-border)' },
      '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--color-border)' },
      '.cm-panel.cm-search': { padding: '6px 8px' },
      '.cm-panel.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '4px' },
      '.cm-textfield': {
        backgroundColor: 'var(--color-background)',
        border: '1px solid var(--color-input)',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--color-foreground)',
        fontSize: '11px',
        padding: '2px 6px',
      },
      '.cm-textfield:focus': { outline: '2px solid var(--color-ring)', outlineOffset: '-1px' },
      '.cm-button': {
        backgroundImage: 'none',
        backgroundColor: 'var(--color-secondary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--color-secondary-foreground)',
        fontSize: '11px',
        padding: '2px 8px',
        cursor: 'default',
      },
      '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--color-accent)' },
      '.cm-panel.cm-search [name="close"]': {
        color: 'var(--color-muted-foreground)',
        fontSize: '16px',
        right: '8px',
        top: '4px',
      },
    },
    { dark },
  );
}

let highlightStyle: Extension | null = null;

/** Coloration syntaxique sur la palette de séries (`--chart-*`), identique clair/sombre. */
function makeHighlight(b: Bundle): Extension {
  if (highlightStyle) return highlightStyle;
  const { tags: t } = b.highlight;
  const style = b.language.HighlightStyle.define([
    {
      tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword],
      color: 'var(--color-chart-1)',
    },
    {
      tag: [t.string, t.special(t.string), t.character, t.docString],
      color: 'var(--color-chart-3)',
    },
    {
      tag: [t.number, t.bool, t.null, t.atom, t.literal, t.regexp, t.escape],
      color: 'var(--color-chart-4)',
    },
    {
      tag: [t.comment, t.lineComment, t.blockComment],
      color: 'var(--color-muted-foreground)',
      fontStyle: 'italic',
    },
    {
      tag: [
        t.function(t.variableName),
        t.function(t.propertyName),
        t.definition(t.function(t.variableName)),
      ],
      color: 'var(--color-chart-2)',
    },
    {
      tag: [t.typeName, t.className, t.namespace, t.macroName, t.annotation],
      color: 'var(--color-chart-6)',
    },
    { tag: [t.propertyName, t.attributeName, t.labelName], color: 'var(--color-chart-2)' },
    { tag: [t.tagName, t.angleBracket], color: 'var(--color-chart-5)' },
    { tag: [t.attributeValue], color: 'var(--color-chart-3)' },
    {
      tag: [t.definition(t.variableName), t.local(t.variableName)],
      color: 'var(--color-foreground)',
    },
    { tag: [t.self, t.special(t.variableName)], color: 'var(--color-chart-5)' },
    { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: 'var(--color-foreground)' },
    { tag: t.meta, color: 'var(--color-muted-foreground)' },
    { tag: t.processingInstruction, color: 'var(--color-chart-5)' },
    { tag: t.heading, fontWeight: '600', color: 'var(--color-chart-1)' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strong, fontWeight: '600' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: [t.link, t.url], color: 'var(--color-info)', textDecoration: 'underline' },
    { tag: t.monospace, color: 'var(--color-chart-3)' },
    { tag: t.quote, color: 'var(--color-muted-foreground)' },
    { tag: t.contentSeparator, color: 'var(--color-muted-foreground)' },
    { tag: t.invalid, color: 'var(--color-destructive)' },
  ]);
  highlightStyle = b.language.syntaxHighlighting(style);
  return highlightStyle;
}

// ---------- Composant ----------

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Chemin du fichier : détermine le langage et réinitialise l'historique quand il change. */
  path: string;
  readOnly?: boolean;
  /** Ctrl+S / Cmd+S. */
  onSave?: () => void;
  className?: string;
}

interface Cursor {
  line: number;
  column: number;
}

interface Compartments {
  theme: InstanceType<Bundle['state']['Compartment']>;
  language: InstanceType<Bundle['state']['Compartment']>;
  readOnly: InstanceType<Bundle['state']['Compartment']>;
}

const readOnlyExtension = (b: Bundle, readOnly: boolean): Extension => [
  b.state.EditorState.readOnly.of(readOnly),
  b.view.EditorView.editable.of(!readOnly),
];

/**
 * Éditeur CodeMirror 6 contrôlé (`value`/`onChange`) avec barre d'état : langage détecté,
 * position du curseur, fin de ligne et encodage.
 */
export function CodeEditor({
  value,
  onChange,
  path,
  readOnly = false,
  onSave,
  className,
}: CodeEditorProps) {
  const { t } = useTranslation();
  const dark = useIsDark();
  const language = detectLanguage(path);
  const lineEnding = detectLineEnding(value);

  const [bundle, setBundle] = useState<Bundle | null>(loadedBundle);
  const [langExt, setLangExt] = useState<{ language: EditorLanguage; ext: Extension | null }>({
    language: 'plain',
    ext: null,
  });
  const [cursor, setCursor] = useState<Cursor>({ line: 1, column: 1 });

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const compartmentsRef = useRef<Compartments | null>(null);
  /** Dernier texte connu du document : évite de réécrire l'éditeur après sa propre frappe. */
  const lastValueRef = useRef(value);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
  });

  // 1. Cœur de CodeMirror (une fois par session).
  useEffect(() => {
    if (bundle) return;
    let cancelled = false;
    void loadBundle().then((b) => {
      if (!cancelled) setBundle(b);
    });
    return () => {
      cancelled = true;
    };
  }, [bundle]);

  // 2. Paquet de langage, par fichier.
  useEffect(() => {
    let cancelled = false;
    void loadLanguage(language).then((ext) => {
      if (!cancelled) setLangExt({ language, ext });
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  // 3. Une vue par fichier ouvert : l'historique d'annulation repart de zéro à chaque changement.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `path` force la recréation ; les autres valeurs sont lues via des refs ou resynchronisées par les effets suivants
  useEffect(() => {
    const host = hostRef.current;
    if (!bundle || !host) return;
    const b = bundle;
    const compartments: Compartments = {
      theme: new b.state.Compartment(),
      language: new b.state.Compartment(),
      readOnly: new b.state.Compartment(),
    };
    const doc = valueRef.current;
    const eol = detectLineEnding(doc);
    const currentLang = detectLanguage(path);
    const initialLang = langExt.language === currentLang ? langExt.ext : null;

    const state = b.state.EditorState.create({
      doc,
      extensions: [
        // Conserve la fin de ligne du fichier à l'enregistrement.
        eol === 'CRLF' ? b.state.EditorState.lineSeparator.of('\r\n') : [],
        b.view.lineNumbers(),
        b.view.highlightActiveLineGutter(),
        b.view.highlightActiveLine(),
        b.view.highlightSpecialChars(),
        b.view.drawSelection(),
        b.view.dropCursor(),
        b.view.rectangularSelection(),
        b.view.crosshairCursor(),
        b.state.EditorState.allowMultipleSelections.of(true),
        b.state.EditorState.tabSize.of(2),
        b.language.indentUnit.of('  '),
        b.language.indentOnInput(),
        b.language.bracketMatching(),
        b.language.foldGutter(),
        b.autocomplete.closeBrackets(),
        b.commands.history(),
        b.search.search({ top: true }),
        b.search.highlightSelectionMatches(),
        b.view.keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
          b.commands.indentWithTab,
          ...b.autocomplete.closeBracketsKeymap,
          ...b.commands.defaultKeymap,
          ...b.search.searchKeymap,
          ...b.commands.historyKeymap,
          ...b.language.foldKeymap,
        ]),
        b.view.EditorView.contentAttributes.of({ 'aria-label': path }),
        compartments.theme.of([makeTheme(b, dark), makeHighlight(b)]),
        compartments.language.of(initialLang ?? []),
        compartments.readOnly.of(readOnlyExtension(b, readOnly)),
        b.view.EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString();
            lastValueRef.current = text;
            onChangeRef.current(text);
          }
          if (update.docChanged || update.selectionSet || update.focusChanged) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            setCursor({ line: line.number, column: head - line.from + 1 });
          }
        }),
      ],
    });
    const view = new b.view.EditorView({ state, parent: host });
    viewRef.current = view;
    compartmentsRef.current = compartments;
    lastValueRef.current = doc;
    setCursor({ line: 1, column: 1 });
    return () => {
      view.destroy();
      viewRef.current = null;
      compartmentsRef.current = null;
    };
  }, [bundle, path]);

  // 4. Valeur imposée de l'extérieur (Rétablir, relecture après écriture de l'agent…).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastValueRef.current) return;
    lastValueRef.current = value;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  // 5. Reconfigurations à chaud.
  useEffect(() => {
    const view = viewRef.current;
    const c = compartmentsRef.current;
    if (!view || !c || !bundle) return;
    view.dispatch({
      effects: c.theme.reconfigure([makeTheme(bundle, dark), makeHighlight(bundle)]),
    });
  }, [bundle, dark]);

  useEffect(() => {
    const view = viewRef.current;
    const c = compartmentsRef.current;
    if (!view || !c || langExt.language !== language) return;
    view.dispatch({ effects: c.language.reconfigure(langExt.ext ?? []) });
  }, [langExt, language]);

  useEffect(() => {
    const view = viewRef.current;
    const c = compartmentsRef.current;
    if (!view || !c || !bundle) return;
    view.dispatch({ effects: c.readOnly.reconfigure(readOnlyExtension(bundle, readOnly)) });
  }, [bundle, readOnly]);

  const languageLabel =
    language === 'plain' ? t('chat.editor.plainText') : LANGUAGE_LABELS[language];

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {bundle ? (
        <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" data-testid="code-editor" />
      ) : (
        <div className="relative min-h-0 flex-1 overflow-auto" aria-busy="true">
          <span className="sticky top-1 float-right mr-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {t('chat.editor.loading')}
          </span>
          <pre className="px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground/70">
            {value}
          </pre>
        </div>
      )}
      <div
        role="group"
        className="flex shrink-0 items-center gap-3 border-t px-3 py-1 text-[11px] text-muted-foreground"
        aria-label={t('chat.editor.status')}
      >
        <span className="min-w-0 flex-1 truncate">{languageLabel}</span>
        <span className="tabular-nums">
          {t('chat.editor.position', { line: cursor.line, column: cursor.column })}
        </span>
        <span>{lineEnding}</span>
        <span>UTF-8</span>
      </div>
    </div>
  );
}
