import js from '@eslint/js'
import prettier from 'eslint-config-prettier/flat'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Architecture rules 1 and 3 in CLAUDE.md: the engine and the books stay pure
// and deterministic. These guardrails only see static code, so the two ways
// around them are banned too: `globalThis` (as in `globalThis.Math.random()`)
// and dynamic `import()`. Browser globals other than window and document are
// left to tsconfig.engine.json, which typechecks this code without the DOM.
const PURE = 'Engine and finance code stays pure (CLAUDE.md rule 1)'
const DETERMINISTIC =
  'Engine and finance code is deterministic: use the seeded RNG in src/engine/rng.ts and advance time with tick() (CLAUDE.md rule 3)'

export default defineConfig([
  globalIgnores(['dist', 'coverage', '.wrangler']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
  },
  {
    files: ['tools/**/*.ts', 'tests/**/*.ts', '*.config.{js,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/engine/**/*.{ts,tsx}', 'src/finance/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(react|react-dom|zustand)(/|$)',
              message: `${PURE}: no React, React DOM or Zustand.`,
            },
            {
              regex: '(^|/)ui(/|$)',
              message: `${PURE}: nothing from src/ui/.`,
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: DETERMINISTIC },
        { object: 'Date', property: 'now', message: DETERMINISTIC },
        { object: 'performance', property: 'now', message: DETERMINISTIC },
        {
          object: 'crypto',
          property: 'getRandomValues',
          message: DETERMINISTIC,
        },
        { object: 'crypto', property: 'randomUUID', message: DETERMINISTIC },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: `${PURE}: no DOM.` },
        { name: 'document', message: `${PURE}: no DOM.` },
        {
          name: 'globalThis',
          message: `${PURE}: no globalThis, which hides globals from these rules.`,
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: DETERMINISTIC,
        },
        {
          selector: "CallExpression[callee.name='Date']",
          message: DETERMINISTIC,
        },
        {
          selector: 'ImportExpression',
          message: `${PURE}: no dynamic import(), which hides the module from these rules.`,
        },
      ],
    },
  },
  prettier,
])
