/**
 * Définition des outils proposés au modèle (JSON Schema, descriptions en anglais : c'est la
 * langue la mieux comprise par les modèles), classification du risque et commandes
 * auto-approuvées.
 */
import type { ToolCall, ToolName, ToolRisk } from './types';

export interface ToolDefinition {
  type: 'function';
  function: {
    name: ToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const str = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', description });

const DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        'List files and folders under a path of the workspace (relative to the workspace root, "." for the root). Respects .gitignore and skips node_modules, target, dist and .git.',
      parameters: {
        type: 'object',
        properties: {
          path: str('Folder to list, relative to the workspace root. Default ".".'),
          depth: int('How many levels to descend, 1 to 3. Default 1.'),
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read a UTF-8 text file of the workspace. Returns the content with line numbers. Use offset/limit for large files.',
      parameters: {
        type: 'object',
        properties: {
          path: str('File path relative to the workspace root.'),
          offset: int('1-based line to start from. Default 1.'),
          limit: int('Maximum number of lines to return. Default 400.'),
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Create or completely overwrite a text file of the workspace. Prefer edit_file for targeted changes to an existing file.',
      parameters: {
        type: 'object',
        properties: {
          path: str('File path relative to the workspace root; parent folders are created.'),
          content: str('Full new content of the file.'),
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Replace an exact text fragment in an existing file. `old` must appear exactly once (include enough surrounding lines to be unique), unless `replace_all` is true. Read the file first.',
      parameters: {
        type: 'object',
        properties: {
          path: str('File path relative to the workspace root.'),
          old: str('Exact text to replace, copied verbatim from the file.'),
          new: str('Replacement text.'),
          replace_all: { type: 'boolean', description: 'Replace every occurrence. Default false.' },
        },
        required: ['path', 'old', 'new'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description:
        'Search file contents in the workspace with a regular expression (Rust regex syntax). Returns matching lines as path:line: text. Respects .gitignore.',
      parameters: {
        type: 'object',
        properties: {
          pattern: str('Regular expression to search for.'),
          glob: str('Optional glob restricting the files, e.g. "src/**/*.ts".'),
          max_results: int('Maximum number of matches, up to 500. Default 100.'),
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Run a shell command in the workspace root (PowerShell on Windows, sh elsewhere) and return its exit code, stdout and stderr. Use it for tests, builds, package managers, `git` and `gh` (GitHub CLI). One command per call; avoid interactive commands.',
      parameters: {
        type: 'object',
        properties: {
          command: str('The command line to run.'),
          timeout_secs: int('Maximum run time in seconds, up to 600. Default 120.'),
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description:
        'Fetch a public web page (http or https) and return its readable text: title, main content, scripts/styles/navigation removed. Use it to read documentation, articles, issues, changelogs or any URL the user mentions, and to follow links found in a page. Cannot reach localhost or private networks, does not run JavaScript, and returns at most max_chars characters (truncated flag set when cut).',
      parameters: {
        type: 'object',
        properties: {
          url: str('Absolute http(s) URL of the page to read.'),
          max_chars: int('Maximum number of characters to return, 200 to 200000. Default 20000.'),
        },
        required: ['url'],
      },
    },
  },
  // ---- Navigateur intégré : le volet est visible, l'utilisateur voit chaque action ----
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description:
        'Open a page in the built-in browser panel (visible to the user) and wait for it to load. Accepts http(s) URLs including localhost dev servers, and files of the workspace (relative path such as "dist/index.html"). Returns the title, final URL, the visible text (truncated) and numbered interactive elements — links, buttons, fields — to use as targets of browser_click and browser_type, plus console errors since load. Use it to test a site you wrote or a running dev server instead of installing Playwright or a headless browser; to simply read a public page, prefer fetch_url.',
      parameters: {
        type: 'object',
        properties: {
          url: str(
            'http(s) URL, or a file path relative to the workspace root (e.g. "index.html").',
          ),
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_read',
      description:
        'Read the page currently shown in the built-in browser: visible text of the whole page or of one element, numbered interactive elements (fresh numbering), and console errors. Call it after a click when the page changed without navigating, or to see more text with a larger max_chars.',
      parameters: {
        type: 'object',
        properties: {
          selector: str('Optional CSS selector of the element to read (default: the whole page).'),
          max_chars: int('Maximum characters of text to return, 200 to 100000. Default 15000.'),
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description:
        'Click an element of the page shown in the built-in browser. The target is an element number from the latest browser_navigate / browser_read / browser_click result, a CSS selector, or the visible text of a link or button. The user sees the click; the result tells whether the URL or title changed and gives an excerpt of the page and its elements afterwards.',
      parameters: {
        type: 'object',
        properties: {
          target: str(
            'Element number (e.g. "3"), CSS selector (e.g. "#submit") or visible text (e.g. "Add to cart").',
          ),
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description:
        'Type text into an input, textarea, select or editable area of the page shown in the built-in browser (replaces the current value and fires input/change events). For a select, text is the option value or label. With submit true, Enter is pressed and the enclosing form is submitted. Returns what changed afterwards, like browser_click.',
      parameters: {
        type: 'object',
        properties: {
          target: str('Element number, CSS selector or visible label/placeholder of the field.'),
          text: str('Text to type (replaces the field content).'),
          submit: {
            type: 'boolean',
            description: 'Press Enter / submit the form after typing. Default false.',
          },
        },
        required: ['target', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_eval',
      description:
        'Run JavaScript in the page shown in the built-in browser and return the value of the last expression (awaited if it is a promise) serialized as JSON, truncated when large. Use it to check DOM state, computed styles, localStorage, or to call functions of the page. The page keeps running; browser_read is cheaper for text.',
      parameters: {
        type: 'object',
        properties: {
          script: str(
            'JavaScript source evaluated in the page, e.g. "document.querySelectorAll(\'li\').length".',
          ),
          timeout_secs: int('Maximum time to wait for the result, 1 to 120 seconds. Default 15.'),
        },
        required: ['script'],
      },
    },
  },
];

export const toolDefinitions = (): ToolDefinition[] => DEFINITIONS;

/** Commandes considérées comme de simple lecture : auto-approuvées avec la politique « lectures ». */
export const DEFAULT_AUTO_COMMANDS: readonly string[] = [
  'git status',
  'git diff',
  'git log',
  'git show',
  'git branch',
  'git remote',
  'git stash list',
  'gh pr list',
  'gh pr view',
  'gh pr checks',
  'gh pr diff',
  'gh issue list',
  'gh issue view',
  'gh run list',
  'gh run view',
  'ls',
  'dir',
  'cat',
  'type',
  'pwd',
  'node --version',
  'pnpm --version',
  'npm --version',
  'cargo --version',
  'python --version',
];

/** Caractères qui enchaînent ou redirigent : une commande qui en contient n'est jamais « lecture ». */
const CHAINING = /[;&|><`]|\$\(/;

/** Normalise une ligne de commande pour la comparer à l'allowlist. */
export const normalizeCommand = (command: string): string =>
  command.trim().replace(/\s+/g, ' ').toLowerCase();

export function isReadOnlyCommand(command: string, allowlist: readonly string[]): boolean {
  const cmd = normalizeCommand(command);
  if (!cmd || CHAINING.test(cmd)) return false;
  return allowlist.some((entry) => {
    const prefix = normalizeCommand(entry);
    return prefix.length > 0 && (cmd === prefix || cmd.startsWith(`${prefix} `));
  });
}

/** Arguments requis dont une chaîne vide est une valeur légitime (fichier vide, suppression d'un bloc). */
const EMPTY_ALLOWED: Partial<Record<ToolName, readonly string[]>> = {
  write_file: ['content'],
  edit_file: ['new'],
};

/** Arguments requis absents ou vides, d'après le schéma de l'outil. */
export function missingArgs(name: ToolName, args: Record<string, unknown>): string[] {
  const def = DEFINITIONS.find((d) => d.function.name === name);
  const required =
    (def?.function.parameters as { required?: string[] } | undefined)?.required ?? [];
  return required.filter((key) => {
    const value = args[key];
    if (value === undefined || value === null) return true;
    return typeof value === 'string' && value === '' && !EMPTY_ALLOWED[name]?.includes(key);
  });
}

/** Arguments JSON d'un appel, tolérant un JSON invalide (objet vide). */
export function parseToolArgs(call: ToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.arguments || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function toolRisk(
  name: ToolName,
  args: Record<string, unknown>,
  allowlist: readonly string[],
): ToolRisk {
  switch (name) {
    case 'list_files':
    case 'read_file':
    case 'search_files':
    case 'fetch_url':
    case 'browser_navigate':
    case 'browser_read':
      return 'read';
    case 'run_command':
      return isReadOnlyCommand(String(args.command ?? ''), allowlist) ? 'read' : 'write';
    default:
      return 'write';
  }
}

/** Clé « toujours autoriser » : le nom de l'outil, ou le programme d'une commande. */
export function approvalKey(name: ToolName, args: Record<string, unknown>): string {
  if (name !== 'run_command') return name;
  const program = normalizeCommand(String(args.command ?? '')).split(' ')[0] ?? '';
  return `cmd:${program}`;
}
