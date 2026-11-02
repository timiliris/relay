/**
 * Volet « Navigateur » : ouverture, page courante, pages visitées par conversation (mémoire
 * seulement, 20 entrées au plus) et dernière page lue pour l'agent.
 *
 * `lastReadPage` est renseignée par le bouton « Lire la page pour l'agent » ; la session
 * principale s'y abonne (`useBrowser.subscribe`) pour insérer le texte dans le composeur.
 */
import { create } from 'zustand';
import type { PageText } from '@/lib/agent/commands';

export const MAX_VISITED = 20;
/** Clé d'historique de l'écran « nouvelle conversation ». */
export const NO_CONVERSATION = 'new';
const SEARCH_URL = 'https://duckduckgo.com/?q=';

export interface VisitedPage {
  url: string;
  title: string | null;
  visitedAt: number;
}

/** Hôte plausible : `example.com`, `sub.example.co.uk:8080`, `localhost:1420`, `192.168.0.1`. */
const HOST_LIKE =
  /^(localhost|(\d{1,3}\.){3}\d{1,3}|[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+)(:\d{1,5})?([/?#].*)?$/u;
/** Schéma d'URL (`https:`, `file:`…) ; `hôte:port` n'en est pas un, le deux-points y précède un chiffre. */
const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/**
 * Transforme la saisie de la barre d'adresse en URL : URL `http(s)` complète conservée,
 * `file://` transmis tel quel (Rust ne l'accepte que dans un dossier de travail), `https://`
 * ajouté devant un hôte, sinon recherche DuckDuckGo. `null` si vide.
 */
export function normalizeAddress(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (SCHEME.test(raw)) {
    if (/^https?:\/\//i.test(raw) && isValidUrl(raw)) return raw;
    if (/^file:\/\//i.test(raw)) return raw;
    return search(raw);
  }
  if (!/\s/.test(raw) && HOST_LIKE.test(raw) && isValidUrl(`https://${raw}`)) {
    return `https://${raw}`;
  }
  return search(raw);
}

const search = (query: string): string => `${SEARCH_URL}${encodeURIComponent(query)}`;

const isValidUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
};

/** Ajoute ou remonte une page en tête de liste, sans doublon d'URL, 20 entrées au plus. */
export function pushVisited(list: VisitedPage[], page: VisitedPage): VisitedPage[] {
  const rest = list.filter((p) => p.url !== page.url);
  const previous = list.find((p) => p.url === page.url);
  return [{ ...page, title: page.title ?? previous?.title ?? null }, ...rest].slice(0, MAX_VISITED);
}

interface BrowserState {
  open: boolean;
  /** URL affichée par le webview (ou à afficher à l'ouverture du volet). */
  url: string | null;
  title: string | null;
  /** Pages visitées par conversation, la plus récente en premier. */
  visited: Record<string, VisitedPage[]>;
  /** Dernière page lue avec « Lire la page pour l'agent » (texte prêt pour le composeur). */
  lastReadPage: PageText | null;

  toggle: () => void;
  setOpen: (open: boolean) => void;
  /** Ouvre le volet sur une URL (depuis un lien ou une carte d'outil, par exemple). */
  openUrl: (url: string) => void;
  /** Page courante annoncée par Rust ; enregistre la visite dans la conversation. */
  navigated: (conversationId: string | null, url: string, title: string | null) => void;
  setLastReadPage: (page: PageText | null) => void;
  clearVisited: (conversationId: string | null) => void;
}

const key = (conversationId: string | null): string => conversationId ?? NO_CONVERSATION;

export const useBrowser = create<BrowserState>()((set) => ({
  open: false,
  url: null,
  title: null,
  visited: {},
  lastReadPage: null,

  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  openUrl: (url) => set({ open: true, url, title: null }),
  navigated: (conversationId, url, title) =>
    set((s) => {
      const k = key(conversationId);
      const sameUrl = s.url === url;
      return {
        url,
        title: title ?? (sameUrl ? s.title : null),
        visited: {
          ...s.visited,
          [k]: pushVisited(s.visited[k] ?? [], { url, title, visitedAt: Date.now() }),
        },
      };
    }),
  setLastReadPage: (page) => set({ lastReadPage: page }),
  clearVisited: (conversationId) =>
    set((s) => {
      const next = { ...s.visited };
      delete next[key(conversationId)];
      return { visited: next };
    }),
}));

/** Pages visitées d'une conversation (référence stable quand il n'y en a pas). */
const NONE: VisitedPage[] = [];
export const selectVisited =
  (conversationId: string | null) =>
  (s: BrowserState): VisitedPage[] =>
    s.visited[key(conversationId)] ?? NONE;
