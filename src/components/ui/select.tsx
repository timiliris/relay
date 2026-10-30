import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Liste déroulante native, stylée comme les champs. */
export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 [&>option]:bg-popover',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
