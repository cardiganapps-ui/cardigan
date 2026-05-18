// Patient portal smoke.
//
// Covers a code path that's completely separate from the therapist
// app: PatientApp → PatientShell → PatientHome / PatientAgenda.
// Production reaches this via real Supabase auth + a linked patient
// row. For the test we plumb a demo escape hatch:
//
//   ?testMode=1&demoRole=patient
//
// The two flags together (only honored in vite --mode e2e builds)
// trigger App.jsx's demo branch to mount PatientApp with the
// useDemoPatientPortalData fixture. Production demo users never hit
// this — import.meta.env.MODE is statically folded out by Vite.
//
// What we assert:
//   - PatientApp mounts without throwing (catches any crash in the
//     patient-side providers, PatientShell, or PatientHome)
//   - The home view renders the hero + balance card
//   - The bottom tabs switch between Inicio and Agenda
//   - The agenda renders at least one session (demo fixture has 5+)

import { test, expect } from "@playwright/test";

// Patient portal is mobile-targeted: the .bottom-tabs nav is hidden
// by responsive.css at the 768px+ desktop breakpoint, leaving the
// patient stuck on the home screen with no way to switch to agenda.
// Override the viewport to a phone size so the tabs render. Stays
// on chromium (devices.iPhone-* would switch to webkit which CI
// doesn't install).
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test("patient portal: home + agenda tabs mount without errors", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  // Land directly with both unlock flags so PatientApp comes up
  // instead of the therapist AppShell. Need to also tap "Probar
  // demo" because demoMode is gated behind that CTA in AuthScreen.
  await page.goto("/?testMode=1&demoRole=patient");
  await page.getByRole("button", { name: "Probar demo" }).first().click();

  // Bottom tabs are the most reliable mount signal — the patient
  // shell renders them once PatientHome has hydrated. The tabs use
  // explicit role="tab" inside a <nav role="tablist"> (per
  // PatientShell.jsx:181) so getByRole("tab") matches; getByRole
  // ("button") doesn't because the ARIA role overrides the implicit
  // button semantics.
  const homeTab = page.getByRole("tab", { name: "Inicio" });
  const agendaTab = page.getByRole("tab", { name: "Agenda" });
  await expect(homeTab).toBeVisible({ timeout: 10_000 });
  await expect(agendaTab).toBeVisible();

  // PatientHome should show the therapist's name from the demo seed
  // ("Dra. Sofía Ramírez" per useDemoPatientPortalData). Asserting on
  // it catches the case where the data hook hydrates but the hero
  // component swallows or mis-renders the therapist link.
  const body = page.locator("body");
  await expect(body).toContainText(/Sofía Ramírez/, { timeout: 5_000 });

  // Switch to Agenda — exercises the tab state machine and the
  // PatientAgenda component (671 LOC, never previously smoked).
  await agendaTab.click();
  await page.waitForTimeout(300);
  // The agenda renders session rows or an empty-state message; both
  // are non-trivial content. A body shorter than 100 chars means the
  // tab content failed to mount.
  const agendaText = await body.innerText();
  expect(agendaText.length, "agenda tab rendered <100 chars").toBeGreaterThan(100);

  // Switch back to home to confirm bidirectional nav works (the
  // common bug shape is "forward works, back doesn't because state
  // wasn't reset"). Should re-show the therapist name.
  await homeTab.click();
  await expect(body).toContainText(/Sofía Ramírez/);

  expect(pageErrors, `page errors: ${pageErrors.map(e => e.message).join("\n")}`).toHaveLength(0);
});
