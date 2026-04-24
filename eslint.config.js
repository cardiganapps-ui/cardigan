import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'scripts']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
        /* Catch bindings are routinely "ignore and move on" patterns
           (try { … } catch (e) { /* non-fatal *\/ }). Don't flag them. */
        caughtErrors: 'none',
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
])
