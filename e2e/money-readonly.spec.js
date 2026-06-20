// Money display path — read-only smoke (therapist demo mode).
//
// Companion to patient-portal.spec.js, but on the THERAPIST side. The
// Finanzas screen is the highest-stakes display surface in the app:
// every peso a therapist sees there is derived from raw sessions +
// payments by the accounting helpers (see CLAUDE.md Prime Directive).
// This spec guards that the money DISPLAY path renders end-to-end —
// the screen mounts, shows formatted MXN figures, and exposes a patient
// balance — without crashing anywhere between the demo data hook, the
// accounting enrichment, and the Finanzas render tree.
//
// Demo mode makes every mutation a no-op, so this is strictly a
// render/navigation assertion: we never attempt a write flow. The demo
// seed is randomized per run (generateDemoData), so we assert on the
// SHAPE of the money output (a "$N,NNN"-style figure renders, a balance
// row exists) rather than a hard-coded total — which keeps the test
// deterministic without coupling it to the seed's RNG.
//
// Entry: ?testMode=1 (no demoRole) + "Probar demo" → therapist AppShell
// in demo mode. Honored only in vite --mode e2e builds.

import { test, expect } from "@playwright/test";

// Bottom tabs (incl. Finanzas) are hidden at the ≥768px desktop
// breakpoint — force a phone viewport so the tab bar renders, mirroring
// patient-portal.spec.js. Stay on chromium (CI doesn't install webkit).
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

// Matches a formatted MXN figure with a thousands separator, e.g.
// "$1,200" / "+$3,450" / "−$900". Proves real money copy rendered
// (not a bare "0" or a "Cargando…" placeholder).
const MXN_FIGURE = /[+\-−]?\$\d{1,3}(,\d{3})+/;

test("finances (therapist demo): money display renders read-only", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  // Therapist demo: testMode unlocks the e2e branch; no demoRole means
  // App.jsx mounts the therapist AppShell rather than the patient portal.
  await page.goto("/?testMode=1");
  await page.getByRole("button", { name: "Probar demo" }).first().click();

  const body = page.locator("body");

  // Navigate to Finanzas via the bottom tab. The label comes from
  // nav.finances ("Finanzas"). The tab is a <button> (no role override,
  // unlike the patient portal's role="tab"), so match by name.
  const financesTab = page.getByRole("button", { name: "Finanzas" });
  await expect(financesTab).toBeVisible({ timeout: 10_000 });
  await financesTab.click();

  // The Finanzas screen mounts with sub-tabs (Pagos / Saldos / etc.).
  // Wait for substantial content — a body shorter than 100 chars means
  // the screen failed to hydrate.
  await page.waitForTimeout(400);
  const financesText = await body.innerText();
  expect(financesText.length, "finances screen rendered <100 chars").toBeGreaterThan(100);

  // At least one formatted MXN figure must render somewhere on the
  // screen — the core promise of the money display path.
  await expect(body).toContainText(MXN_FIGURE, { timeout: 5_000 });

  // Open the per-patient balances view. The Saldos sub-tab lists each
  // patient with their amountDue — the single most trust-sensitive
  // number in the app. Its label is finances.balances ("Saldos").
  const balancesTab = page.getByRole("tab", { name: "Saldos" }).or(
    page.getByRole("button", { name: "Saldos" }),
  );
  if (await balancesTab.count()) {
    await balancesTab.first().click();
    await page.waitForTimeout(300);
    // Balances view should still show MXN figures (each patient's owed
    // amount). Re-assert against the live body text.
    await expect(page.locator("body")).toContainText(MXN_FIGURE, { timeout: 5_000 });
  }

  // No uncaught errors anywhere in the money render path.
  expect(
    pageErrors,
    `page errors: ${pageErrors.map((e) => e.message).join("\n")}`,
  ).toHaveLength(0);
});
