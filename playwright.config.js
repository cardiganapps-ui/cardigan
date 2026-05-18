// Playwright config for Cardigan smoke tests. One browser project
// (chromium-headless-shell) keeps install + CI cost minimal. Single
// worker so the shared preview server doesn't get races between
// tests. Tests live in ./e2e/.
//
// Build path: vite build --mode e2e uses .env.e2e (fake Supabase
// values to satisfy supabaseClient.js's module-init). Preview
// serves the resulting dist/ on a fixed port. Tests exercise demo
// mode end-to-end — no auth setup, no DB cleanup.

import { defineConfig, devices } from "@playwright/test";

const PORT = 5180;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // CI reporters: github (inline annotations in PR/run) + html
  // (downloadable artifact for traces/videos when a test fails) +
  // list (readable log lines). Local: list only.
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
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run build:e2e && npx vite preview --mode e2e --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    timeout: 90_000,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
});
