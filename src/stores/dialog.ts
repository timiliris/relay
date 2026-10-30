/**
 * Dialogues intégrés à l'application (confirmation, saisie, information), à la
 * place des boîtes natives du système. API à base de promesses :
 *   if (await dialog.confirm({ ... })) …
 */
import { create } from 'zustand';

interface BaseRequest {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface ConfirmRequest extends BaseRequest {
  kind: 'confirm';
  resolve: (ok: boolean) => void;
}

export interface PromptRequest extends BaseRequest {
  kind: 'prompt';
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  resolve: (value: string | null) => void;
}

export interface AlertRequest extends BaseRequest {
  kind: 'alert';
  resolve: () => void;
}

export type DialogRequest = ConfirmRequest | PromptRequest | AlertRequest;

interface DialogState {
  current: DialogRequest | null;
  queue: DialogRequest[];
  push: (request: DialogRequest) => void;
  /** Termine le dialogue courant et passe au suivant. */
  next: () => void;
}

export const useDialog = create<DialogState>()((set) => ({
  current: null,
  queue: [],
  push: (request) =>
    set((s) => (s.current ? { queue: [...s.queue, request] } : { current: request })),
  next: () => set((s) => ({ current: s.queue[0] ?? null, queue: s.queue.slice(1) })),
}));

type Options = Omit<BaseRequest, 'title'> & { title: string };

export const dialog = {
  confirm: (options: Options) =>
    new Promise<boolean>((resolve) =>
      useDialog.getState().push({ kind: 'confirm', ...options, resolve }),
    ),
  prompt: (options: Options & { label?: string; defaultValue?: string; placeholder?: string }) =>
    new Promise<string | null>((resolve) =>
      useDialog.getState().push({ kind: 'prompt', ...options, resolve }),
    ),
  alert: (options: Options) =>
    new Promise<void>((resolve) =>
      useDialog.getState().push({ kind: 'alert', ...options, resolve }),
    ),
};
