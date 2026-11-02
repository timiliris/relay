import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

interface SectionProps {
  /** Ancre de navigation (`#id`) et cible du sommaire. */
  id: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Action(s) alignée(s) à droite du titre (ex. « Valeurs par défaut »). */
  actions?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}

/** Section des paramètres : carte avec icône, titre, description et contenu espacé. */
export function SettingsSection({
  id,
  icon: Icon,
  title,
  description,
  actions,
  children,
  contentClassName,
}: SectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4">
      <Card>
        <CardHeader className="flex-row items-start gap-3">
          <span
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle id={`${id}-title`} className="text-base">
              {title}
            </CardTitle>
            {description && <CardDescription className="mt-1">{description}</CardDescription>}
          </div>
          {actions}
        </CardHeader>
        <CardContent className={cn('flex flex-col gap-4 text-sm', contentClassName)}>
          {children}
        </CardContent>
      </Card>
    </section>
  );
}

/** Sous-groupe d'une section, avec un intertitre discret. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </div>
  );
}

/** Libellé à gauche (avec indice optionnel), contrôle à droite. */
export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p>{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

/** Libellé au-dessus d'un contrôle pleine largeur, valeur courante à droite. */
export function Field({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-3 text-xs">
        <span>{label}</span>
        {value && <span className="font-mono text-muted-foreground">{value}</span>}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <kbd className="rounded-md border bg-muted px-2 py-0.5 font-mono text-xs">{keys}</kbd>
    </div>
  );
}
