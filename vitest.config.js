import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // happy-dom is lighter than jsdom for hook tests. Scope it to tests
    // that actually need it via the environmentMatchGlobs fallback — pure
    // utils tests keep running in node.
    environment: "node",
    environmentMatchGlobs: [
      ["src/hooks/__tests__/**", "happy-dom"],
      // Component tests (.test.tsx anywhere under src) render real DOM via
      // @testing-library/react, so they need happy-dom too. Pure utils
      // tests (.test.ts) stay in the lighter node env.
      ["src/**/__tests__/**/*.test.tsx", "happy-dom"],
    ],
    setupFiles: ["./src/test/setup.ts"],
    globals: false,
    // Vitest's default include pattern (`**/*.{test,spec}.{js,...}`)
    // would scoop up the Playwright spec in e2e/ and try to run it
    // with vitest — which crashes because @playwright/test's `test()`
    // throws when invoked outside the Playwright runner. Keep the
    // two test surfaces strictly separate.
    exclude: ["node_modules", "dist", "e2e/**", ".git"],
    // ── Coverage gate (WS-4) ──
    // Intentionally scoped to the financial kernel. accounting.ts carries
    // the canonical amountDue formula (PRIME DIRECTIVE); enforcing full
    // line/statement coverage here mechanically implements CLAUDE.md's
    // rule that "any new accounting branch gets a test before shipping".
    // Only active when `--coverage` is passed (see `npm run test:coverage`),
    // so the default `npm test` run is unaffected. Branches floor sits just
    // under today's 93.75% to allow an existing defensive path without
    // forcing a contrived test, while still catching a real regression.
    // Broaden `include` via the CLI for ad-hoc whole-app exploration.
    coverage: {
      provider: "v8",
      include: ["src/utils/accounting.ts"],
      reporter: ["text", "text-summary"],
      thresholds: {
        statements: 100,
        lines: 100,
        functions: 100,
        branches: 90,
      },
    },
  },
});
