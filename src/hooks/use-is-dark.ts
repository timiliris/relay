import { useSyncExternalStore } from 'react';

const root = typeof document === 'undefined' ? null : document.documentElement;

function subscribe(onChange: () => void): () => void {
  if (!root) return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

const getSnapshot = () => root?.classList.contains('dark') ?? false;

/** `true` quand la classe `dark` est posée sur <html> (suit le thème effectif). */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
