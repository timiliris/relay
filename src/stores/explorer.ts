/**
 * Volet « Fichiers » du dossier de travail : ouverture, fichier à afficher et rafraîchissement
 * déclenché par les écritures de l'agent.
 */
import { create } from 'zustand';

interface ExplorerState {
  open: boolean;
  /** Fichier à sélectionner dans le volet (chemin relatif au dossier de travail). */
  pendingPath: string | null;
  /** Incrémenté à chaque écriture ou édition : le volet relit ce qu'il affiche. */
  version: number;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  /** Ouvre le volet sur un fichier (depuis une carte d'outil, par exemple). */
  openFile: (path: string) => void;
  consumePending: () => void;
  refresh: () => void;
}

export const useExplorer = create<ExplorerState>()((set) => ({
  open: false,
  pendingPath: null,
  version: 0,
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  openFile: (path) => set({ open: true, pendingPath: path }),
  consumePending: () => set({ pendingPath: null }),
  refresh: () => set((s) => ({ version: s.version + 1 })),
}));
