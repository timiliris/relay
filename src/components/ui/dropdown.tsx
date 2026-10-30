import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface DropdownProps {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  /** `top` pour un déclencheur en bas de fenêtre (composer). */
  side?: 'top' | 'bottom';
  className?: string;
}

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';
const GAP = 4;

/**
 * Menu déroulant sans dépendance, rendu dans un portail (position fixe) pour ne
 * jamais être rogné par un conteneur défilant. Fermeture au clic extérieur et à
 * Échap, navigation clavier (↑ ↓ Début Fin) entre les éléments `role="menuitem"`.
 */
export function Dropdown({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  className,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<React.CSSProperties | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // Positionne le menu par rapport au déclencheur (recalculé au redimensionnement).
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      // Le conteneur est en `display: contents` : on mesure le déclencheur lui-même.
      const rect = triggerRef.current?.firstElementChild?.getBoundingClientRect();
      if (!rect) return;
      const style: React.CSSProperties = { position: 'fixed' };
      if (side === 'top') style.bottom = window.innerHeight - rect.top + GAP;
      else style.top = rect.bottom + GAP;
      if (align === 'end') style.right = Math.max(8, window.innerWidth - rect.right);
      else style.left = Math.max(8, rect.left);
      setPosition(style);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, side, align]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
      if (items.length === 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      // Ne détourne pas les flèches d'un champ de saisie (recherche de modèles, etc.).
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName) && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? items.length - 1
            : e.key === 'ArrowDown'
              ? (current + 1) % items.length
              : (current - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <div ref={triggerRef} className="contents">
        {trigger({ open, toggle: () => setOpen((o) => !o) })}
      </div>
      {open &&
        position &&
        createPortal(
          <div
            id={id}
            ref={menuRef}
            role="menu"
            style={position}
            className={cn(
              'z-50 min-w-44 animate-pop overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg',
              className,
            )}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}

export function DropdownItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<'button'> & { destructive?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent [&_svg]:size-4 [&_svg]:shrink-0',
        destructive && 'text-destructive hover:bg-destructive/10',
        className,
      )}
      {...props}
    />
  );
}
