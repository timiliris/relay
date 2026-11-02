import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SettingsNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface SettingsNavProps {
  items: SettingsNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  label: string;
}

/** Sommaire des paramètres : colonne fixe sur écran large, rangée défilante sur écran étroit. */
export function SettingsNav({ items, activeId, onSelect, label }: SettingsNavProps) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:pb-0">
      {items.map(({ id, label: text, icon: Icon }) => {
        const active = id === activeId;
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? 'true' : undefined}
            onClick={() => onSelect(id)}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm whitespace-nowrap transition-colors',
              active
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            <Icon className={cn('size-4 shrink-0', active && 'text-primary')} aria-hidden="true" />
            {text}
          </button>
        );
      })}
    </nav>
  );
}
