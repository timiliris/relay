import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/use-theme';
import type { Theme } from '@/stores/settings';
import { Button } from './ui/button';

const order: Theme[] = ['light', 'dark', 'system'];

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const label = t(`theme.${theme}`);

  const next = () => {
    const index = order.indexOf(theme);
    setTheme(order[(index + 1) % order.length] ?? 'system');
  };

  return (
    <Button variant="ghost" size="icon" onClick={next} aria-label={label} title={label}>
      <Icon />
    </Button>
  );
}
