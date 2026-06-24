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
    // ── Coverage gate (WS-4 + WS-10) ──
    // Two tiers, both only active under `--coverage` (see
    // `npm run test:coverage`); the default `npm test` run is unaffected.
    //
    // 1. The financial KERNEL (accounting.ts) keeps its strict gate via a
    //    file-specific threshold: it carries the canonical amountDue formula
    //    (PRIME DIRECTIVE), so CLAUDE.md's "any new accounting branch gets a
    //    test before shipping" is enforced at 100% stmts/lines/funcs, 90%
    //    branches (floor just under today's 93.75% for one defensive path).
    //
    // 2. WS-10 broadens the ratchet to the kernel's NEIGHBORS — the pure
    //    integrity helpers that feed money math + scheduling (recurrence /
    //    expense backfill cap, the optimistic-revert primitive, opening
    //    balance, the patient-edit + new-patient payload builders, slot
    //    finding + conflict detection, patient filtering). The root-level
    //    thresholds below apply to every included file NOT matched by the
    //    accounting glob; they're floored just under today's measured
    //    coverage (stmts 96.4 / branch 88.6 aggregate, recurrence.ts the
    //    weakest at 94.4 / 84.4) so a real regression fails CI without
    //    forcing contrived tests. Raise the floor as coverage improves.
    //
    // Broaden `include` via the CLI for ad-hoc whole-app exploration.
    coverage: {
      provider: "v8",
      include: [
        "src/utils/accounting.ts",
        "src/utils/recurrence.ts",
        "src/utils/openingBalance.ts",
        "src/utils/patientEditPayload.ts",
        "src/utils/patientFilter.ts",
        "src/utils/scheduleSlots.ts",
        "src/utils/scheduleConflicts.ts",
        "src/lib/optimistic.ts",
        "src/components/sheets/newPatientPayload.ts",
      ],
      reporter: ["text", "text-summary"],
      thresholds: {
        // Kernel — strict, unchanged.
        "src/utils/accounting.ts": {
          statements: 100,
          lines: 100,
          functions: 100,
          branches: 90,
        },
        // Integrity neighbors (every included file NOT matched above).
        statements: 94,
        lines: 100,
        functions: 100,
        branches: 84,
      },
    },
  },
});
