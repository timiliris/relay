import { useEffect, useRef, useState } from 'react';

/**
 * Renvoie `value` mise à jour au plus toutes les `intervalMs` millisecondes
 * (la dernière valeur est toujours livrée). Utile pour un rendu coûteux
 * alimenté par un flux rapide, comme le Markdown pendant le streaming.
 */
export function useThrottledValue<T>(value: T, intervalMs: number, enabled = true): T {
  const [throttled, setThrottled] = useState(value);
  const lastUpdate = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setThrottled(value);
      return;
    }
    const elapsed = Date.now() - lastUpdate.current;
    if (elapsed >= intervalMs) {
      lastUpdate.current = Date.now();
      setThrottled(value);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      lastUpdate.current = Date.now();
      setThrottled(value);
    }, intervalMs - elapsed);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, intervalMs, enabled]);

  return enabled ? throttled : value;
}
