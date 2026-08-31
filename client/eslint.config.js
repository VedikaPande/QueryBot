import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      // eslint-plugin-react-hooks v7 exposes flat configs under `configs.flat`;
      // the top-level entries are still the legacy eslintrc shape, which flat
      // config rejects outright.
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    rules: {
      // Allow deliberately unused args when they document a signature, provided
      // they are underscore-prefixed.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      // shadcn/ui components deliberately export their cva variant objects
      // alongside the component; that is the convention this project follows.
      'react-refresh/only-export-components': [
        'error',
        { allowConstantExport: true, allowExportNames: ['buttonVariants', 'badgeVariants'] },
      ],
    },
  },
])
