// Patient expediente smoke.
//
// Opens the first patient from the Pacientes screen and exercises
// the four expediente tabs (Resumen / Sesiones / Finanzas / Archivo).
// Catches: any tab-component mount crash (each is its own file
// in src/screens/expediente/), the tab-switching state machine,
// patient row click → screen transition.
//
// Each tab render is a "did this throw?" check via pageerror. We
// don't deep-assert tab content (that would couple too tightly to
// demo data) — the value is catching crashes, not content drift.

import { test, expect } from "@playwright/test";

test("patients: expediente opens and cycles through all 4 tabs", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await page.goto("/?testMode=1");
  await page.getByRole("button", { name: "Probar demo" }).first().click();

  // Pacientes screen via hash routing.
  await page.evaluate(() => { window.location.hash = "#patients"; });

  // Demo data seeds ~10 patients (data/demoData.js). Wait for at
  // least one row, then tap it. Patient rows use the .row-item class
  // — same as the rest of the app's list pattern.
  const firstPatientRow = page.locator(".row-item").first();
  await expect(firstPatientRow).toBeVisible({ timeout: 10_000 });
  await firstPatientRow.click();

  // Expediente has TWO role="tablist" elements: the section tabs
  // (Resumen / Sesiones / Pagos / Archivo) and a "Período" filter
  // segmented control. Disambiguate by filtering to the expediente
  // tabs explicitly. Mobile-vs-desktop layout shows either the
  // .expediente-inline-tabs nav or the inline tab row at the top of
  // the screen; both carry the same accessible tab buttons, so we
  // grab them by accessible name and scope to the first hit.
  // Tab labels: "Resumen", "Sesiones", "Pagos" (NOT "Finanzas" —
  // the label is t("finances.payments")), "Archivo".
  const tabLabels = ["Resumen", "Sesiones", "Pagos", "Archivo"];

  // Confirm at least the first tab is visible before cycling.
  const firstTab = page.getByRole("tab", { name: /^Resumen$/ }).first();
  await expect(firstTab).toBeVisible({ timeout: 5_000 });

  for (const label of tabLabels) {
    const tab = page.getByRole("tab", { name: new RegExp(`^${label}$`) }).first();
    await expect(tab, `tab "${label}" not visible`).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    // Give React + any tab-mount effect a tick to settle so a crash
    // on tab-content render surfaces in pageerror before we move on.
    await page.waitForTimeout(150);
  }

  expect(pageErrors, `page errors: ${pageErrors.map(e => e.message).join("\n")}`).toHaveLength(0);
});
