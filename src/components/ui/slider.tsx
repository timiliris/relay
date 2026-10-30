import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

interface SliderProps extends Omit<ComponentProps<'input'>, 'type' | 'onChange' | 'value'> {
  value: number;
  onValueChange: (value: number) => void;
}

/** Curseur natif stylé (accent-color suit le thème). */
export function Slider({ value, onValueChange, className, ...props }: SliderProps) {
  return (
    <input
      type="range"
      value={value}
      onChange={(e) => onValueChange(Number(e.target.value))}
      className={cn('h-1.5 w-full cursor-pointer accent-primary', className)}
      {...props}
    />
  );
}
