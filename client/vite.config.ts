import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // import.meta.dirname, not __dirname: the latter is unavailable under
      // Vite's native config loader, which becomes the default in Vite 9.
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    // The PDF and Excel writers are dynamically imported and land in their own
    // chunks; the remaining app code sits comfortably under this.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Split vendor code out so an application change does not invalidate
        // the framework chunk in users' caches on every deploy. Rolldown, which
        // backs Vite 8, accepts only the function form of this option.
        manualChunks: (id: string) => {
          if (!id.includes('node_modules')) return undefined;

          if (/[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) {
            return 'react';
          }
          if (/[\\/]node_modules[\\/](@reduxjs|react-redux|immer|redux)/.test(id)) {
            return 'state';
          }
          if (/[\\/]node_modules[\\/](react-markdown|remark|rehype|mdast|micromark|hast|unist|lowlight|highlight\.js)/.test(id)) {
            return 'markdown';
          }

          // Everything else keeps the default treatment. Returning a constant
          // here would pull the lazily-imported PDF and Excel writers into the
          // initial payload, undoing their dynamic import.
          return undefined;
        },
      },
    },
  },
});
