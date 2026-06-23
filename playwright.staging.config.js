// Playwright config for the REAL-AUTH money-write E2E (e2e/money-write.spec.js).
//
// Unlike playwright.config.js (hermetic demo smoke), this build is wired
// to the dedicated STAGING Supabase project — it signs in as a real seeded
// user and exercises the actual write path (create/record/delete) through
// real RLS + the counter triggers. See WS-0 / WS-5b.
//
// Build path: vite build --mode e2e-staging reads .env.e2e-staging
// (VITE_SUPABASE_URL + anon for staging). The spec reads the test
// credentials from E2E_USER_EMAIL / E2E_USER_PASSWORD at run time.
//
// Gated: skips itself when the test creds are absent (forks / local
// without secrets), so it never fails for want of staging access.

import { defineConfig, devices } from "@playwright/test";

const PORT = 5181; // distinct from the demo smoke's 5180

export default defineConfig({
  testDir: "./e2e",
  testMatch: /money-write\.spec\.js/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // single worker — the spec mutates a shared staging row
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }], ["list"]]
    : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // Phone viewport so the bottom-tab bar renders (hidden ≥768px),
      // matching the other mobile-flow specs.
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: `npm run build:e2e-staging && npx vite preview --mode e2e-staging --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
});
