import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import reactPlugin from 'eslint-plugin-react'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/* Accessibility lint surfaced as WARN (non-blocking) — the Phase 3
   a11y worklist. Burn the warnings down, then promote individual rules
   to 'error' as each reaches zero. Downgrading the recommended set keeps
   CI green during adoption instead of breaking it on day one. */
const a11yWarnRules = Object.fromEntries(
  Object.entries(jsxA11y.flatConfigs.recommended.rules).map(([rule, level]) => {
    // Preserve rules the recommended set ships as 'off' (deprecated /
    // overly-strict: label-has-for, control-has-associated-label,
    // anchor-ambiguous-text). Only downgrade the genuinely-recommended
    // 'error' rules to 'warn' for the non-blocking adoption phase.
    const isOff = level === 'off' || (Array.isArray(level) && level[0] === 'off')
    return [rule, isOff ? 'off' : 'warn']
  }),
)

/* Promoted to 'error' (WS-9): rules burned down to zero, so they now BLOCK
   CI — a new violation can't slip in. Spread AFTER a11yWarnRules so it wins.
   Add rules here as each category reaches zero; the rest stay at 'warn' on
   the worklist (the big three — click-events-have-key-events /
   no-static-element-interactions / no-noninteractive-element-interactions —
   are the remaining div/span-onClick sweep). */
const a11yErrorRules = {
  'jsx-a11y/no-autofocus': 'error',
  'jsx-a11y/interactive-supports-focus': 'error',
  'jsx-a11y/no-noninteractive-tabindex': 'error',
}

/* ── Design-system gate ──
   A raw rgba(0,0,0,…) box-shadow in an inline style does NOT flip in
   dark mode — it stays a black shadow on a dark surface and reads as
   invisible/muddy. Use a --shadow-* / --shadow-overlay / --shadow-sheet-up
   token instead (they have dark-mode overrides in dark.css). Colored
   accent glows (rgba(91,155,175,…)) and the Stripe Elements appearance
   config are intentionally exempt: neither matches this selector (wrong
   color / not under a `style` attribute). First hard-enforced rule of the
   design-token burn-down; fontSize / hex / cream rules join as each
   category reaches zero. */
/* Inline rgba(0,0,0,…) in ANY style property: a black shadow / scrim /
   border that doesn't flip in dark mode (stays black on a dark surface,
   reading as muddy or invisible). Generalized from the old boxShadow-only
   selector to also catch backdrops and borders. Use a dark-aware token:
   --scrim-bg / --scrim-bg-strong (overlays), --shadow-* (elevation), or
   --border-* (dividers). Applied everywhere — harmless in api/ (no JSX). */
const blackRgbaSelector = {
  selector: "JSXAttribute[name.name='style'] Literal[value=/rgba\\(\\s*0\\s*,\\s*0\\s*,\\s*0/]",
  message: 'Inline rgba(0,0,0,…) does not flip in dark mode — use a --scrim-bg / --scrim-bg-strong / --shadow-* / --border-* token instead.',
}
/* Inline cubic-bezier(…) easing: keep motion timing in the --ease-*
   vocabulary so curves stay consistent and tunable from one place.
   Matches both string literals and template literals under a style attr. */
const easingSelector = {
  selector: "JSXAttribute[name.name='style'] :matches(Literal[value=/cubic-bezier/], TemplateElement[value.raw=/cubic-bezier/])",
  message: 'Inline cubic-bezier(…) easing — use an --ease-out / --ease-in / --ease-in-out / --ease-spring / --ease-spring-soft token instead.',
}
const designTokenRules = {
  'no-restricted-syntax': ['error', blackRgbaSelector, easingSelector],
}

/* Relative imports in the Vite-bundled frontend (src/) must be
   extensionless. An explicit ".js"/".jsx" breaks the production Rollup
   build the moment the target migrates to .ts/.tsx (vitest's resolver is
   lenient, so tests pass while `vite build` fails) — exactly the
   dates.js→dates.ts break. NOTE: scoped to src/ only — api/ and scripts/
   run as Node ESM where explicit extensions are required, not bundled. */
const srcImportExtMessage =
  'Use an extensionless relative import (drop the .js/.jsx) — explicit extensions break the Vite build when the target migrates to TypeScript.'
const frontendRestrictedSyntax = {
  'no-restricted-syntax': ['error',
    blackRgbaSelector,
    easingSelector,
    { selector: "ImportDeclaration[source.value=/^\\.\\.?\\/.*\\.jsx?$/]", message: srcImportExtMessage },
    { selector: "ImportExpression[source.value=/^\\.\\.?\\/.*\\.jsx?$/]", message: srcImportExtMessage },
  ],
}

/* Shared React JSX correctness rules (apply to both JS and TS sources). */
const reactJsxRules = {
  /* Catch <Foo /> where Foo isn't imported — would have caught the
     IconMail oversight that crashed the referral sheet at runtime. */
  'react/jsx-no-undef': ['error', { allowGlobals: false }],
  /* Mark JSX-used identifiers as "used" so unused-vars doesn't flag
     imported components like IconMail above. */
  'react/jsx-uses-vars': 'error',
}

const browserLanguageOptions = {
  ecmaVersion: 2020,
  globals: {
    ...globals.browser,
    // Compile-time constants baked in by vite.config.js's `define`.
    __VERCEL_DEPLOYMENT_ID__: 'readonly',
    __SENTRY_DSN__: 'readonly',
    __SENTRY_RELEASE__: 'readonly',
  },
  parserOptions: {
    ecmaVersion: 'latest',
    ecmaFeatures: { jsx: true },
    sourceType: 'module',
  },
}

const unusedVarsOpts = {
  varsIgnorePattern: '^[A-Z_]',
  argsIgnorePattern: '^_',
  /* Catch bindings are routinely "ignore and move on" patterns
     (try { … } catch (e) { /* non-fatal *\/ }). Don't flag them. */
  caughtErrors: 'none',
}

export default defineConfig([
  globalIgnores(['dist', 'scripts', 'android']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: { react: reactPlugin, 'jsx-a11y': jsxA11y },
    languageOptions: browserLanguageOptions,
    rules: {
      ...a11yWarnRules,
      ...a11yErrorRules,
      'no-unused-vars': ['error', unusedVarsOpts],
      ...reactJsxRules,
      ...designTokenRules,
    },
  },
  {
    /* TypeScript sources (Phase 4 migration). Same React/a11y/design-token
       gates as JS, plus typescript-eslint's (non-type-checked) recommended
       set so migrated files don't escape linting. The TS-aware
       no-unused-vars supersedes the core rule. */
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: { react: reactPlugin, 'jsx-a11y': jsxA11y },
    languageOptions: browserLanguageOptions,
    rules: {
      ...a11yWarnRules,
      ...a11yErrorRules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', unusedVarsOpts],
      ...reactJsxRules,
      ...designTokenRules,
    },
  },
  {
    /* Frontend only: forbid explicit .js/.jsx in relative imports (see
       frontendRestrictedSyntax). Placed after the base js/ts blocks so
       this no-restricted-syntax (which still includes the shadow rule)
       replaces theirs for src/ files. */
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    rules: frontendRestrictedSyntax,
  },
  {
    /* api/ files are Vercel serverless functions — Node runtime, not
       browser. Expose Node globals (process, Buffer, etc.) so legitimate
       uses of process.env aren't flagged as no-undef. Covers both the
       remaining .js functions and the migrated .ts ones — the base
       **\/*.{ts,tsx} block sets browser globals, so api .ts needs this
       override to restore Node globals. */
    files: ['api/**/*.{js,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    /* Build-tool config files run in Node and read process.env. */
    files: ['vite.config.js', 'vitest.config.js', 'eslint.config.js', 'playwright.config.js', 'playwright.staging.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    /* Playwright e2e specs use browser + Playwright globals via
       imports; they run in Node so process is available too. */
    files: ['e2e/**/*.{js,mjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-console': 'off',
    },
  },
])
