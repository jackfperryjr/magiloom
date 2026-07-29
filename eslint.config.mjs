// Flat config (ESLint 9). The repo is CommonJS, so this file is .mjs to keep the
// ESM plugin imports working without flipping package.json's type.
//
// Scope is `src` only — that's what `npm run lint` passes and what CI checks. The
// vite configs and scripts/ are build glue that already fails loudly when broken.
//
// Type-aware linting (projectService) is deliberately off: it needs a full program
// per run, which turns a ~2s lint into a slow one, and `tsc --noEmit` already runs
// as its own check and covers the type errors those rules would find.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['dist/**', 'out/**', 'docs/**', 'build/**', 'src/renderer/public/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // One env for every layer: main is Node, renderer is browser, and the
      // preload bridge straddles both. Splitting them per-directory would catch
      // a `window` reference in main/, but nothing here has needed that yet.
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Underscore-prefixed args and caught errors are the existing convention for
      // "required by the signature, deliberately unused".
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
)
