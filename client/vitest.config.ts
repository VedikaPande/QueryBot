import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // import.meta.dirname, not __dirname: the latter is unavailable under
      // Vite's native config loader, which becomes the default in Vite 9.
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/test/**',
        'src/**/*.test.{ts,tsx}',
        'src/main.tsx',
        // Presentational shadcn primitives: thin wrappers over Radix with no
        // logic of our own worth asserting on.
        'src/components/ui/**',
        'src/types/**',
      ],
    },
  },
});
