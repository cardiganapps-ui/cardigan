// Avatar picker smoke.
//
// Direct regression for the "blank preview circle" bug shipped in
// commit 9fd5441's session: the picker rendered <img src={draft.imageUrl}>
// but fromCurrent() only sets draft.path, not imageUrl, so the
// preview was silently empty even when the user had a real photo
// set. useAvatarUrl() now resolves the path via cache + presigned
// URL, matching what every other avatar surface does.
//
// This test asserts the picker mounts AND its preview slot has some
// visible content — either an <img> with a non-empty src for a user
// with an uploaded avatar, or the initials fallback. Either passes;
// a blank circle (the bug) does not.

import { test, expect } from "@playwright/test";

test("settings: avatar picker mounts with non-blank preview", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await page.goto("/?testMode=1");
  await page.getByRole("button", { name: "Probar demo" }).first().click();

  // Open Settings via the topbar avatar button (aria-label="Ajustes"
  // in es.js — t("nav.settings")). Hash-based routing makes a direct
  // location change the cleanest path.
  await page.evaluate(() => { window.location.hash = "#settings"; });

  // Tap the avatar card on Settings to open the picker. The card is
  // a button labeled "Cambiar foto" (t("avatar.title")).
  const openPicker = page.getByRole("button", { name: "Cambiar foto" }).first();
  await expect(openPicker).toBeVisible({ timeout: 10_000 });
  await openPicker.click();

  // Sheet header confirms mount.
  const sheetTitle = page.getByRole("dialog", { name: "Cambiar foto" });
  await expect(sheetTitle).toBeVisible({ timeout: 5_000 });

  // Preview circle is `.av-picker-preview` (per AvatarPicker.jsx
  // line 276). Demo user has no uploaded avatar, so the preview
  // should be the initials fallback — assert the slot is non-empty.
  // For an uploaded-avatar user the assertion would catch an <img>
  // with an empty src (the regression we just fixed).
  const preview = page.locator(".av-picker-preview");
  await expect(preview).toBeVisible();
  const previewText = await preview.evaluate((el) => el.textContent || "");
  const hasImg = await preview.locator("img").count();
  expect(previewText.length > 0 || hasImg > 0,
    `preview circle was blank — textContent="${previewText}" img count=${hasImg}`).toBe(true);
  // If there's an <img>, its src must be non-empty (the actual
  // regression). Blank initials are acceptable for no-avatar users;
  // blank <img> is the bug.
  if (hasImg > 0) {
    const src = await preview.locator("img").first().getAttribute("src");
    expect(src, "preview <img> rendered with empty src").toBeTruthy();
  }

  expect(pageErrors, `page errors: ${pageErrors.map(e => e.message).join("\n")}`).toHaveLength(0);
});
