import type { ComponentProps } from 'react';
import { Button } from './button';

/** Bouton icône avec libellé accessible et info-bulle native. */
export function IconButton({
  label,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label} {...props}>
      {children}
    </Button>
  );
}
