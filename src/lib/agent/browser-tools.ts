/**
 * Outils de l'agent sur le navigateur intégré : le modèle ouvre une page, la lit, clique, saisit
 * et exécute du script dans le volet « Navigateur », sous les yeux de l'utilisateur (pas de
 * navigateur sans tête). Tout passe par trois commandes Rust : `browser_validate_url`,
 * `browser_wait_load` (fin de chargement) et `browser_eval` (script avec valeur de retour) ;
 * la lecture et les actions sont des scripts injectés dans la page, définis ici.
 *
 * Numérotation : chaque lecture (`browser_navigate`, `browser_read`, et l'extrait renvoyé après
 * un clic ou une saisie) renumérote les éléments interactifs visibles et marque chacun d'un
 * attribut `data-relay-ref` ; `browser_click` / `browser_type` acceptent ce numéro, un sélecteur
 * CSS ou le texte visible.
 */
import { useBrowser } from '@/stores/browser';
import { browserCommands } from './commands';
import type { ToolName } from './types';
import type { WebToolOutcome } from './web-tools';

export const DEFAULT_READ_CHARS = 15_000;
export const MIN_READ_CHARS = 200;
export const MAX_READ_CHARS = 100_000;
/** Éléments interactifs numérotés au plus par lecture. */
export const MAX_ELEMENTS = 150;
/** Extrait renvoyé après un clic ou une saisie (texte, puis éléments). */
export const EXCERPT_CHARS = 1_500;
export const EXCERPT_ELEMENTS = 40;
/** Attente de la fin du chargement d'une page. */
export const LOAD_TIMEOUT_MS = 20_000;
/** Délai laissé à une action pour déclencher une navigation avant de relire la page. */
export const SETTLE_MS = 400;
export const DEFAULT_EVAL_SECS = 15;
export const MAX_EVAL_SECS = 120;

export interface PageElement {
  n: number;
  /** `link`, `button`, type d'`input` (`text`, `checkbox`…), `textarea`, `select`, rôle ARIA… */
  kind: string;
  text?: string;
  href?: string;
  name?: string;
  placeholder?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  options?: string[];
}

export interface ConsoleEntry {
  level: string;
  message: string;
}

/** Instantané d'une page tel que le script de lecture le renvoie. */
export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  elements: PageElement[];
  errors: ConsoleEntry[];
  /** `true` si le sélecteur demandé ne correspond à aucun élément. */
  missing?: boolean;
}

interface ActionResult {
  error?: string;
  element?: { kind: string; text: string; name?: string };
  submitted?: boolean;
}

const clamp = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/** Schéma d’URL ; `hôte:port` n’en est pas un (le deux-points y précède un chiffre). */
const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?([/?#]|$)/i;
const HOST_LIKE = /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]|$)/i;
/** Extensions de fichiers : `index.html` est un fichier du dossier, pas un nom de domaine. */
const FILE_EXTENSION =
  /\.(x?html?|svg|pdf|txt|md|css|m?js|json|xml|png|jpe?g|gif|webp|ico)(:\d+)?([/?#]|$)/i;

/**
 * URL à ouvrir d'après l'argument du modèle : URL absolue conservée, hôte local ou nom de
 * domaine complété, sinon chemin relatif au dossier de travail converti en `file://`.
 */
export function resolveUrl(input: string, workspace: string): string {
  const raw = input.trim();
  if (SCHEME.test(raw)) return raw;
  if (LOCAL_HOST.test(raw)) return `http://${raw}`;
  if (HOST_LIKE.test(raw) && !FILE_EXTENSION.test(raw)) return `https://${raw}`;
  const relative = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  const root = workspace.replace(/\\/g, '/').replace(/\/+$/, '');
  return `file:///${encodeURI(`${root}/${relative}`.replace(/^\/+/, ''))}`;
}

/** Sélecteur des éléments avec lesquels le modèle peut interagir. */
const INTERACTIVE =
  'a[href], button, input, textarea, select, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="option"], [contenteditable]:not([contenteditable="false"]), [onclick]';

/** Script de lecture : texte visible, éléments numérotés (`data-relay-ref`), journal de console. */
export function readScript(options: {
  selector?: string | undefined;
  maxChars: number;
  maxElements: number;
}): string {
  return `(() => {
  const o = ${JSON.stringify(options)};
  const root = o.selector ? document.querySelector(o.selector) : document.body || document.documentElement;
  if (!root) return { missing: true, url: location.href, title: document.title, text: '', truncated: false, elements: [], errors: [] };
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const cut = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  for (const old of document.querySelectorAll('[data-relay-ref]')) old.removeAttribute('data-relay-ref');
  const elements = [];
  for (const el of root.querySelectorAll(${JSON.stringify(INTERACTIVE)})) {
    if (elements.length >= o.maxElements) break;
    const tag = el.tagName.toLowerCase();
    const type = tag === 'input' ? (el.type || 'text').toLowerCase() : '';
    if (type === 'hidden' || el.closest('[hidden]') || !visible(el)) continue;
    const n = elements.length + 1;
    el.setAttribute('data-relay-ref', String(n));
    const item = {
      n,
      kind: tag === 'a' ? 'link' : tag === 'input' ? type : ['button', 'textarea', 'select', 'summary'].includes(tag) ? tag : el.getAttribute('role') || tag,
    };
    let text = clean(el.innerText || el.textContent);
    if (!text) {
      const img = el.querySelector && el.querySelector('img[alt]');
      text = clean(el.getAttribute('aria-label') || el.getAttribute('title') || (img && img.alt));
    }
    if (!text && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
      const label = el.labels && el.labels[0];
      text = clean(label ? label.innerText : el.getAttribute('aria-label'));
    }
    if (!text && tag === 'input' && ['submit', 'button', 'reset'].includes(type)) text = clean(el.value);
    if (text) item.text = cut(text, 80);
    if (tag === 'a') item.href = el.href;
    if (el.name) item.name = el.name;
    if (el.placeholder) item.placeholder = cut(el.placeholder, 60);
    if (tag === 'textarea' || (tag === 'input' && !['password', 'checkbox', 'radio', 'submit', 'button', 'reset', 'file'].includes(type))) {
      item.value = cut(el.value || '', 80);
    }
    if (tag === 'select') {
      item.value = el.value;
      item.options = [...el.options].slice(0, 12).map((op) => clean(op.textContent));
    }
    if (type === 'checkbox' || type === 'radio') item.checked = el.checked;
    if (el.disabled) item.disabled = true;
    elements.push(item);
  }
  let text = (root.innerText || root.textContent || '').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
  const truncated = text.length > o.maxChars;
  if (truncated) text = text.slice(0, o.maxChars);
  const errors = Array.isArray(window.__relayLog) ? window.__relayLog.slice(-20) : [];
  return { url: location.href, title: document.title, text, truncated, elements, errors };
})()`;
}

/** Script d'action : trouve la cible (numéro, sélecteur, texte), la met en évidence, clique ou saisit. */
export function actionScript(options: {
  action: 'click' | 'type';
  target: string;
  text?: string;
  submit?: boolean;
}): string {
  return `(() => {
  const o = ${JSON.stringify(options)};
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => el.getClientRects().length > 0;
  const textOf = (el) => clean(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.placeholder).toLowerCase();
  const find = () => {
    const t = String(o.target).trim();
    if (/^\\d+$/.test(t)) {
      const el = document.querySelector('[data-relay-ref="' + t + '"]');
      return el ? { el } : { error: 'No element numbered ' + t + ': call browser_read to refresh the numbering.' };
    }
    try {
      const el = document.querySelector(t);
      if (el) return { el };
    } catch (e) {}
    const lower = t.toLowerCase();
    const all = [...document.querySelectorAll(${JSON.stringify(`${INTERACTIVE}, label`)})].filter(visible);
    const exact = all.find((el) => textOf(el) === lower);
    if (exact) return { el: exact };
    const partial = all.find((el) => textOf(el).includes(lower));
    if (partial) return { el: partial };
    return { error: 'No element matches "' + t + '" (number, CSS selector or visible text).' };
  };
  const found = find();
  if (!found.el) return { error: found.error };
  let el = found.el;
  if (el instanceof HTMLLabelElement && el.control) el = el.control;
  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const kind = tag === 'a' ? 'link' : tag === 'input' ? (el.type || 'text').toLowerCase() : el.getAttribute('role') || tag;
    const text = clean(el.innerText || el.textContent || el.getAttribute('aria-label') || el.placeholder || el.value).slice(0, 80);
    return el.name ? { kind, text, name: el.name } : { kind, text };
  };
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const previous = [el.style.outline, el.style.outlineOffset];
  el.style.outline = '3px solid #f59e0b';
  el.style.outlineOffset = '2px';
  setTimeout(() => { el.style.outline = previous[0]; el.style.outlineOffset = previous[1]; }, 800);
  if (o.action === 'click') {
    if (el.disabled) return { error: 'The element is disabled.', element: describe(el) };
    if (typeof el.focus === 'function') el.focus();
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return { element: describe(el) };
  }
  const text = String(o.text ?? '');
  if (el.disabled || el.readOnly) return { error: 'The field is disabled or read-only.', element: describe(el) };
  el.focus();
  if (el instanceof HTMLSelectElement) {
    const options = [...el.options];
    const option = options.find((op) => op.value === text || clean(op.textContent) === text)
      || options.find((op) => clean(op.textContent).toLowerCase().includes(text.toLowerCase()));
    if (!option) return { error: 'No option matches "' + text + '".', element: describe(el) };
    el.value = option.value;
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, text); else el.value = text;
  } else if (el.isContentEditable) {
    el.textContent = '';
    if (!document.execCommand('insertText', false, text)) el.textContent = text;
  } else {
    return { error: 'The element is not an input, textarea, select or editable area.', element: describe(el) };
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  let submitted = false;
  if (o.submit) {
    const key = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    const notPrevented = el.dispatchEvent(new KeyboardEvent('keydown', key));
    el.dispatchEvent(new KeyboardEvent('keypress', key));
    el.dispatchEvent(new KeyboardEvent('keyup', key));
    const form = el.form || el.closest('form');
    if (notPrevented && form && !(el instanceof HTMLTextAreaElement)) {
      if (typeof form.requestSubmit === 'function') form.requestSubmit(); else form.submit();
      submitted = true;
    }
  }
  return { element: describe(el), submitted };
})()`;
}

/** Exécute un script interne et renvoie sa valeur ; une exception devient une erreur d'outil. */
async function runScript<T>(script: string): Promise<T> {
  const outcome = await browserCommands.eval(script, LOAD_TIMEOUT_MS);
  if (!outcome.ok) throw new Error(describeFailure(outcome.json));
  return JSON.parse(outcome.json) as T;
}

/** Message d'une exception sérialisée par l'enveloppe (`{ name, message }`) ou valeur brute. */
export function describeFailure(json: string): string {
  try {
    const value = JSON.parse(json) as unknown;
    if (value && typeof value === 'object' && 'message' in value) {
      const { name, message } = value as { name?: unknown; message?: unknown };
      return name && name !== 'Error' ? `${String(name)}: ${String(message)}` : String(message);
    }
    return typeof value === 'string' ? value : json;
  } catch {
    return json;
  }
}

const readPage = (selector: string | undefined, maxChars: number, maxElements: number) =>
  runScript<PageSnapshot>(readScript({ selector, maxChars, maxElements }));

/** Ligne décrivant un élément numéroté pour le modèle. */
export function formatElement(el: PageElement): string {
  const parts = [`[${el.n}] ${el.kind}`];
  if (el.text) parts.push(JSON.stringify(el.text));
  if (el.name) parts.push(`name=${el.name}`);
  if (el.placeholder) parts.push(`placeholder=${JSON.stringify(el.placeholder)}`);
  if (el.value !== undefined && el.value !== '') parts.push(`value=${JSON.stringify(el.value)}`);
  if (el.options) parts.push(`options: ${el.options.join(' | ')}`);
  if (el.checked !== undefined) parts.push(el.checked ? 'checked' : 'unchecked');
  if (el.disabled) parts.push('disabled');
  if (el.href) parts.push(`→ ${el.href}`);
  return parts.join(' ');
}

/** Texte renvoyé au modèle : en-tête, texte, éléments numérotés, erreurs de console. */
export function formatSnapshot(
  page: PageSnapshot,
  options: { loaded?: boolean; maxElements?: number } = {},
): string {
  const header = [
    page.title ? `# ${page.title}` : null,
    `URL: ${page.url}`,
    options.loaded === false ? '(the page was still loading when read)' : null,
    page.truncated ? '(text truncated: call browser_read with a larger max_chars for more)' : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  const sections = [header, page.text.trim() ? page.text : '(no visible text)'];
  const elements = options.maxElements
    ? page.elements.slice(0, options.maxElements)
    : page.elements;
  if (elements.length) {
    const lines = elements.map(formatElement);
    if (elements.length < page.elements.length) {
      lines.push(`… ${page.elements.length - elements.length} more (call browser_read)`);
    }
    sections.push(`Interactive elements (use the number as target):\n${lines.join('\n')}`);
  }
  if (page.errors.length) {
    const lines = page.errors.map((e) => `- ${e.level}: ${e.message}`);
    sections.push(`Console since page load:\n${lines.join('\n')}`);
  }
  return sections.join('\n\n');
}

/** Ouvre `url` dans le volet (création du webview par le volet si besoin) et attend la page. */
async function navigate(rawUrl: string, workspace: string): Promise<WebToolOutcome> {
  const url = await browserCommands.validateUrl(resolveUrl(rawUrl, workspace));
  const browser = useBrowser.getState();
  if (browser.open && browser.url === url) {
    // Même page : recharger plutôt que ne rien faire (le modèle vient souvent de la modifier).
    try {
      await browserCommands.reload();
    } catch {
      // Webview absent (création échouée) : repasser par le volet, qui le recrée.
      useBrowser.setState({ url: null });
      browser.openUrl(url);
    }
  } else {
    browser.openUrl(url);
  }
  const loaded = await browserCommands.waitLoad(LOAD_TIMEOUT_MS, 0);
  const page = await readPage(undefined, DEFAULT_READ_CHARS, MAX_ELEMENTS);
  return {
    content: formatSnapshot(page, { loaded: loaded.loaded }),
    meta: { truncated: page.truncated },
  };
}

/** Décrit l'action faite et ce qui a changé (URL, titre), puis un extrait de la page. */
async function act(
  options: Parameters<typeof actionScript>[0],
  before: { url: string | null; title: string | null },
): Promise<WebToolOutcome> {
  const result = await runScript<ActionResult>(actionScript(options));
  if (result.error) throw new Error(result.error);
  const element = result.element ?? { kind: 'element', text: '' };
  const loaded = await browserCommands.waitLoad(LOAD_TIMEOUT_MS, SETTLE_MS);
  const page = await readPage(undefined, EXCERPT_CHARS, MAX_ELEMENTS);
  const label = element.text ? `${element.kind} ${JSON.stringify(element.text)}` : element.kind;
  const verb =
    options.action === 'click'
      ? `Clicked ${label}.`
      : `Typed ${JSON.stringify(options.text ?? '')} into ${label}${
          options.submit
            ? result.submitted
              ? ' and submitted the form.'
              : ' and pressed Enter.'
            : '.'
        }`;
  const changed =
    before.url !== page.url
      ? `Navigated to ${page.url}`
      : before.title !== null && before.title !== page.title
        ? `Same URL, title changed to ${JSON.stringify(page.title)}`
        : 'URL and title unchanged';
  return {
    content: `${verb}\n${changed}${loaded.loaded ? '' : ' (still loading)'}.\n\nPage now:\n${formatSnapshot(
      page,
      { maxElements: EXCERPT_ELEMENTS },
    )}`,
    meta: {},
  };
}

/** État de la page avant une action, d'après le volet (URL et titre annoncés par Rust). */
const pageBefore = () => {
  const { url, title } = useBrowser.getState();
  return { url, title };
};

/** Exécute un outil navigateur ; les erreurs remontent au runner, qui les transforme en résultat `error`. */
export async function executeBrowserTool(
  name: ToolName,
  args: Record<string, unknown>,
  workspace: string,
): Promise<WebToolOutcome> {
  switch (name) {
    case 'browser_navigate':
      return navigate(String(args.url ?? ''), workspace);
    case 'browser_read': {
      const selector =
        typeof args.selector === 'string' && args.selector.trim()
          ? args.selector.trim()
          : undefined;
      const page = await readPage(
        selector,
        clamp(args.max_chars, DEFAULT_READ_CHARS, MIN_READ_CHARS, MAX_READ_CHARS),
        MAX_ELEMENTS,
      );
      if (page.missing)
        throw new Error(`No element matches the selector ${JSON.stringify(selector)}.`);
      return { content: formatSnapshot(page), meta: { truncated: page.truncated } };
    }
    case 'browser_click':
      return act({ action: 'click', target: String(args.target ?? '') }, pageBefore());
    case 'browser_type':
      return act(
        {
          action: 'type',
          target: String(args.target ?? ''),
          text: String(args.text ?? ''),
          submit: Boolean(args.submit),
        },
        pageBefore(),
      );
    case 'browser_eval': {
      const timeout = clamp(args.timeout_secs, DEFAULT_EVAL_SECS, 1, MAX_EVAL_SECS) * 1000;
      const outcome = await browserCommands.eval(String(args.script ?? ''), timeout);
      if (!outcome.ok) {
        return {
          content: `Error: ${describeFailure(outcome.json)}`,
          meta: { status: 'error', error: describeFailure(outcome.json) },
        };
      }
      const suffix = outcome.truncated ? '\n… (result truncated)' : '';
      return {
        content: `${prettyJson(outcome.json)}${suffix}`,
        meta: { truncated: outcome.truncated },
      };
    }
    default:
      throw new Error(`Unknown browser tool: ${name}`);
  }
}

/** JSON indenté quand il est valide et court, sinon tel quel (résultat tronqué par exemple). */
export function prettyJson(json: string): string {
  if (json.length > 4_000) return json;
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
