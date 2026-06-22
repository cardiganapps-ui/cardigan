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
  },
});
