// Navigation smoke.
//
// Walks the major top-level screens via hash routing and asserts
// each renders without throwing. Catches:
//   - lazy-import chunk failures (the SW-stuck class we hit earlier
//     today, plus any future Vite bundling regression)
//   - screen-level mount crashes (a missing context value, a
//     useEffect dep landing in TDZ, etc.)
//   - any unhandled promise rejection on initial render
//
// Doesn't assert specific content — that would couple tightly to
// demo data shape. Just confirms the body has non-trivial text
// after navigation, which is enough to know React rendered.

import { test, expect } from "@playwright/test";

test("navigation: every top-level screen mounts without errors", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await page.goto("/?testMode=1");
  await page.getByRole("button", { name: "Probar demo" }).first().click();

  // Hash routes. Order intentionally mirrors the bottom-tab order
  // a real therapist sees: home → agenda → patients → finances →
  // archivo → settings. Sweeping in nav order ensures we don't
  // accidentally skip the screen the user lands on after each tap.
  const screens = ["home", "agenda", "patients", "finances", "archivo", "settings"];
  for (const screen of screens) {
    await page.evaluate((s) => { window.location.hash = `#${s}`; }, screen);
    // Wait for any lazy chunk to land and the screen to commit. The
    // body should always have some Spanish text after a successful
    // render (the topbar carries "cardigan" + bottom tabs carry
    // "Inicio / Agenda / …" labels). 100 chars catches the "blank
    // body / ErrorBoundary fallback / chunk-load failure" case.
    await page.waitForTimeout(400);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length, `screen "${screen}" rendered <100 chars of text`).toBeGreaterThan(100);
    // ErrorBoundary fallback is "Algo salió mal" — explicit guard
    // so a screen-level throw doesn't slip through as "the topbar
    // rendered, that counts."
    expect(bodyText, `screen "${screen}" hit the ErrorBoundary`).not.toContain("Algo salió mal");
  }

  expect(pageErrors, `page errors: ${pageErrors.map(e => e.message).join("\n")}`).toHaveLength(0);
});
