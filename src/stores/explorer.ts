/**
 * Volet « Fichiers » du dossier de travail : ouverture, fichier à afficher et rafraîchissement
 * déclenché par les écritures de l'agent.
 */
import { create } from 'zustand';
import type { Attachment } from '@/lib/db';

/** Fichier que le volet demande au composeur de joindre au message (bouton « Ajouter au message »). */
export interface AttachRequest {
  /** Chemin relatif au dossier de travail. */
  path: string;
  /** Taille connue en octets, pour refuser sans lecture les fichiers trop gros. */
  size: number | null;
}

interface ExplorerState {
  open: boolean;
  /** Fichier à sélectionner dans le volet (chemin relatif au dossier de travail). */
  pendingPath: string | null;
  /** Incrémenté à chaque écriture ou édition : le volet relit ce qu'il affiche. */
  version: number;
  /**
   * File d'attente des fichiers à joindre, consommée par le composeur (`Composer` avec
   * `workspace`) : le volet ne connaît pas le composeur, il dépose ici et le composeur lit
   * le fichier et l'ajoute à ses pièces jointes.
   */
  attachRequests: AttachRequest[];
  /** Pièces jointes déjà construites (page web lue, par exemple), consommées par le composeur. */
  readyAttachments: Attachment[];
  toggle: () => void;
  setOpen: (open: boolean) => void;
  /** Ouvre le volet sur un fichier (depuis une carte d'outil, par exemple). */
  openFile: (path: string) => void;
  consumePending: () => void;
  refresh: () => void;
  requestAttach: (path: string, size?: number | null) => void;
  consumeAttachRequests: () => void;
  attachReady: (attachment: Attachment) => void;
  consumeReadyAttachments: () => void;
}

export const useExplorer = create<ExplorerState>()((set) => ({
  open: false,
  pendingPath: null,
  version: 0,
  attachRequests: [],
  readyAttachments: [],
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  openFile: (path) => set({ open: true, pendingPath: path }),
  consumePending: () => set({ pendingPath: null }),
  refresh: () => set((s) => ({ version: s.version + 1 })),
  requestAttach: (path, size = null) =>
    set((s) => ({ attachRequests: [...s.attachRequests, { path, size }] })),
  consumeAttachRequests: () => set({ attachRequests: [] }),
  attachReady: (attachment) =>
    set((s) => ({ readyAttachments: [...s.readyAttachments, attachment] })),
  consumeReadyAttachments: () => set({ readyAttachments: [] }),
}));
