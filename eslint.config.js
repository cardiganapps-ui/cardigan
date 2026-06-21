import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import reactPlugin from 'eslint-plugin-react'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import { defineConfig, globalIgnores } from 'eslint/config'

/* Accessibility lint surfaced as WARN (non-blocking) — the Phase 3
   a11y worklist. Burn the warnings down, then promote individual rules
   to 'error' as each reaches zero. Downgrading the recommended set keeps
   CI green during adoption instead of breaking it on day one. */
const a11yWarnRules = Object.fromEntries(
  Object.keys(jsxA11y.flatConfigs.recommended.rules).map((rule) => [rule, 'warn']),
)

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
    languageOptions: {
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
    },
    rules: {
      ...a11yWarnRules,
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
        /* Catch bindings are routinely "ignore and move on" patterns
           (try { … } catch (e) { /* non-fatal *\/ }). Don't flag them. */
        caughtErrors: 'none',
      }],
      /* Catch <Foo /> where Foo isn't imported — would have caught
         the IconMail oversight that crashed the referral sheet at
         runtime. JSX element names aren't visible to plain no-undef
         without the React plugin. */
      'react/jsx-no-undef': ['error', { allowGlobals: false }],
      /* Mark JSX-used identifiers as "used" so no-unused-vars
         doesn't flag imported components like IconMail above. */
      'react/jsx-uses-vars': 'error',
      /* ── Design-system gate ──
         A raw rgba(0,0,0,…) box-shadow in an inline style does NOT
         flip in dark mode — it stays a black shadow on a dark surface
         and reads as invisible/muddy. Use a --shadow-* / --shadow-overlay
         / --shadow-sheet-up token instead (they have dark-mode overrides
         in dark.css). Colored accent glows (rgba(91,155,175,…)) and the
         Stripe Elements appearance config are intentionally exempt:
         neither matches this selector (wrong color / not under a `style`
         attribute). This is the first hard-enforced rule of the
         design-token burn-down; the fontSize / hex / cream rules join it
         as each category reaches zero. */
      'no-restricted-syntax': ['error', {
        selector: "JSXAttribute[name.name='style'] Property[key.name='boxShadow'] Literal[value=/rgba\\(\\s*0\\s*,\\s*0\\s*,\\s*0/]",
        message: 'Inline rgba(0,0,0,…) box-shadow breaks dark mode — use a --shadow-* / --shadow-overlay / --shadow-sheet-up token instead.',
      }],
    },
  },
  {
    /* api/ files are Vercel serverless functions — Node runtime, not
       browser. Expose Node globals (process, Buffer, etc.) so legitimate
       uses of process.env aren't flagged as no-undef. */
    files: ['api/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    /* Build-tool config files run in Node and read process.env. */
    files: ['vite.config.js', 'vitest.config.js', 'eslint.config.js', 'playwright.config.js'],
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
