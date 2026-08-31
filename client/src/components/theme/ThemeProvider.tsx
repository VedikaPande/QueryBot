import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Mounts the theme context.
 *
 * `next-themes` was already a dependency and `index.css` already defined a full
 * `.dark` palette, but nothing ever mounted a provider - so the dark theme was
 * unreachable. `attribute="class"` matches the `@custom-variant dark` rule.
 */
const ThemeProvider = ({ children }: ThemeProviderProps) => (
  <NextThemesProvider
    attribute="class"
    defaultTheme="system"
    enableSystem
    // Suppresses the transition flash when switching themes.
    disableTransitionOnChange
  >
    {children}
  </NextThemesProvider>
);

export default ThemeProvider;
