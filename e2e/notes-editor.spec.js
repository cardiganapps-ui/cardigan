// Notes editor smoke test.
//
// Catches the bug classes that shipped past lint + 715 vitest tests
// during the Notes premium polish work:
//   - TDZ at mount (headingsSignature use-before-declare in NoteEditor)
//   - stale-closure on rapid type-after-delete in MarkdownEditor
//   - any plain "did the editor render?" smoke
//
// Runs against demo mode (no auth, no Supabase calls) so this is
// stable, hermetic, and fast — well under 10s end-to-end.

import { test, expect } from "@playwright/test";

// Single test scoped to one user journey: land → demo → open note →
// type → delete → type → assert. Keeping it as one test (vs.
// splitting per action) means a crash in mount immediately fails the
// whole suite, which is what we want from a smoke test.
test("notes editor: mount + type + delete + type", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  // 1. Land on the marketing page. ?testMode=1 unlocks demo mode's
  //    readOnly flag (only honored in `vite --mode e2e` builds — see
  //    useDemoData.js) so the editor's contenteditable is actually
  //    editable. Without this we couldn't catch the stale-closure
  //    typing bug; only the mount-time TDZ class.
  await page.goto("/?testMode=1");

  // 2. Enter demo mode. "Probar demo" is a hard-coded label in
  //    LandingPage.jsx; using getByRole keeps it stable to layout
  //    shuffles. The button appears in three spots (hero, mid-page,
  //    footer) — .first() picks the visible one above the fold.
  await page.getByRole("button", { name: "Probar demo" }).first().click();

  // 3. Navigate to the Notas tab inside Archivo. Hash-based routing,
  //    so a direct URL change is reliable and avoids depending on the
  //    bottom-tab markup, which has shifted historically.
  await page.evaluate(() => { window.location.hash = "#archivo"; });

  // 4. Demo data seeds 2-4 notes per patient (data/demoData.js line
  //    742). Wait for at least one note row to land before clicking.
  //    .note-card-row is the stable class added in Phase B polish.
  const firstRow = page.locator(".note-card-row").first();
  await expect(firstRow).toBeVisible({ timeout: 10_000 });
  await firstRow.click();

  // 5. The editor's contenteditable surface has class .mde-root.
  //    Waiting on it confirms the NoteEditor mounted without
  //    throwing — this is the bare-minimum check that would have
  //    caught the TDZ crash instantly.
  const editor = page.locator(".mde-root");
  await expect(editor).toBeVisible({ timeout: 5_000 });

  // Sanity: the testMode escape hatch is active. If demo readOnly
  // is still on (testMode flag not honored), contenteditable will
  // be "false" and the rest of the test would silently no-op.
  await expect(editor).toHaveAttribute("contenteditable", "true");

  // Click inside the LAST line of existing content so the caret
  // lands at a known position. Clicking the .mde-root wrapper drops
  // focus on the wrapper, which sometimes lands in odd places on
  // contenteditable; clicking the last line div is reliable.
  await editor.locator(".mde-line").last().click();

  // 6. Move caret to the end of the current content so our typed
  //    chars append rather than landing somewhere mid-document. iOS
  //    Safari and headless Chromium both honor Ctrl/Cmd+End for end-
  //    of-content; Playwright's "End" key on the body works too.
  await page.keyboard.press("ControlOrMeta+End");

  // 7. Add a recognisable marker so we can assert on it later. We
  //    use a newline so we don't pollute an existing line — the
  //    assertion looks for our exact marker string.
  await page.keyboard.press("Enter");
  await page.keyboard.type("smoketest-abc", { delay: 30 });

  // 8. Repro the stale-closure bug: delete one char, type another
  //    fast. Before the linesRef fix, typing 'D' after deleting 'c'
  //    would resurrect 'c' because the onBeforeInput handler read
  //    `lines` from the stale React closure. The delay between
  //    keystrokes is deliberately tiny (10ms) to push React's batch
  //    edge.
  await page.keyboard.press("Backspace");
  await page.keyboard.type("D", { delay: 10 });

  // 9. Read back the editor's plaintext content (textContent collapses
  //    the per-line spans into a single string). The marker should
  //    now read "smoketest-abD" — NOT "smoketest-abcD" (the
  //    pre-fix bug) and NOT "smoketest-aD" (a different breakage).
  const text = await editor.evaluate((el) => el.textContent || "");
  expect(text).toContain("smoketest-abD");
  expect(text).not.toContain("smoketest-abcD");

  // 10. Catches both class of failures in one assert: no unhandled
  //     exceptions during the entire journey. ErrorBoundary catches
  //     React render throws; pageerror catches anything that escapes
  //     handlers. Either path would have flagged today's bugs.
  expect(pageErrors, `page errors: ${pageErrors.map(e => e.message).join("\n")}`).toHaveLength(0);
});
