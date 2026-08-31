import { useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
] as const;

interface ThemeToggleProps {
  className?: string;
}

/** Never changes, so the store never notifies; only the initial value matters. */
const noopSubscribe = () => () => {};

/**
 * Three-way theme switch.
 *
 * Renders a fixed-size placeholder until mounted, because the resolved theme is
 * unknown during first paint and swapping icons later would shift the layout.
 * `useSyncExternalStore` supplies the mounted flag without a setState-in-effect.
 */
const ThemeToggle = ({ className }: ThemeToggleProps) => {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );

  if (!mounted) {
    return <div className={cn('h-9 w-[7.5rem] rounded-lg bg-muted/50', className)} aria-hidden />;
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn('inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5', className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const isActive = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            onClick={() => setTheme(value)}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
              isActive
                ? 'bg-card text-primary shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
};

export default ThemeToggle;
