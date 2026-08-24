// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import solid from 'eslint-plugin-solid/configs/typescript';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

/**
 * Flat config for the whole workspace.
 *
 * Scope is deliberate. The type-aware rule families that flag every `await res.json()` as unsafe
 * (`no-unsafe-assignment` and friends) are OFF: the REST boundary is a known, separately-tracked
 * concern, and switching them on today would bury the rules below under thousands of hits and make
 * the gate unadoptable. What is enabled is the set that catches defects found by hand in this
 * codebase — Solid reactivity mistakes, and promises whose rejection nobody handles.
 *
 * Raise the bar in a later pass, once the data layer is consolidated.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.vite/**',
      'packages/*/vite.config.ts',
      'eslint.config.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── One quote style, enforced rather than swept ──────────────────────────────────────
  // The repo was split — `packages/ui` was mostly double-quoted, everything else single — which
  // showed up as noise in every cross-package diff. This is the whole formatting opinion that is
  // gated: a rule (not a one-off `--fix` run) so the split cannot reappear. `avoidEscape` keeps a
  // string containing an apostrophe double-quoted rather than escaping it, and JSX attributes are
  // untouched — `quotes` does not apply to them, and double is the HTML convention there.
  {
    files: ['packages/*/**/*.{ts,tsx,js}'],
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: false }],
    },
  },

  // ── Solid: the class of bug TypeScript cannot see ────────────────────────────────────
  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    ...solid,
  },

  // ── Type-aware, narrowly scoped ──────────────────────────────────────────────────────
  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser },
    },
    rules: {
      // Solid's JSX transform assigns `ref={el}` to the `let el` it was given, which core ESLint
      // cannot see — so this rule reports every ref in the codebase as never assigned. 35 hits,
      // all of that shape, none real. It has no Solid-aware equivalent; the plugin's own rules
      // cover refs.
      'no-unassigned-vars': 'off',

      // A rejected promise nobody handles fails silently.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // Unused code is how dead branches survive a refactor. Underscore-prefixed args stay legal
      // so a signature can document a parameter it deliberately ignores.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  // ── Tests: node globals, and fixtures may shadow ─────────────────────────────────────
  {
    files: ['packages/*/src/**/*.test.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },

  // ── Plain-JS tooling (the Vite factory) ──────────────────────────────────────────────
  {
    files: ['packages/build/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
