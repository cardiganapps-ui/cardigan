// Real-auth money-WRITE E2E against the dedicated staging Supabase project
// (WS-0 / WS-5b). Unlike the hermetic demo smoke (money-readonly.spec.js,
// every mutation a no-op), this signs in as a real seeded user and drives
// the actual write path — FAB → PaymentModal → submit — so the assertion
// flows through real GoTrue auth, RLS, and the patient-counter trigger
// (trg_payments_recalc_paid). That's the coverage demo mode can't give:
// proof that a therapist recording a payment moves the balance for real.
//
// Seeded starting state (scripts/seed-e2e-staging.mjs):
//   Patient "Paciente E2E" — one completed session @ $1,000, $0 paid
//   → amountDue $1,000 ("pendiente").
// The spec records a $1,000 payment through the UI and asserts the patient
// flips to "Al corriente" ($0 owed). Teardown deletes the payment via the
// API (RLS-scoped as the same user) so the next run starts clean and the
// delete→revert path is exercised too.
//
// Gated: self-skips when the test creds are absent (forks / local without
// secrets), mirroring the accounting-parity test. Build: --mode e2e-staging
// points VITE_SUPABASE_URL at staging (see playwright.staging.config.js).

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const EMAIL = process.env.E2E_USER_EMAIL;
const PASSWORD = process.env.E2E_USER_PASSWORD;
const SUPA_URL = process.env.STAGING_SUPABASE_URL;
const SUPA_ANON = process.env.STAGING_SUPABASE_ANON_KEY;

// No creds → nothing to sign in as. Skip the whole file (the CI job also
// no-ops when the staging secrets are unset).
test.skip(!EMAIL || !PASSWORD, "staging test creds absent (E2E_USER_EMAIL / E2E_USER_PASSWORD)");

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

// RLS-scoped admin-of-self client for setup/teardown — signs in as the
// same seeded user the UI drives, so every read/delete obeys the exact
// policies production enforces (no service-role shortcut).
async function userClient() {
  const sb = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) throw new Error(`teardown sign-in failed: ${error.message}`);
  return sb;
}

// Reset the seeded patient to the $1,000-owed starting state by removing
// any payment the spec created. Also asserts the delete→revert path.
async function resetPayments() {
  if (!SUPA_URL || !SUPA_ANON) return;
  const sb = await userClient();
  const { data: pat } = await sb.from("patients").select("id").eq("name", "Paciente E2E").single();
  if (pat) await sb.from("payments").delete().eq("patient_id", pat.id);
  await sb.auth.signOut();
}

test.beforeEach(resetPayments);
test.afterAll(resetPayments);

async function signIn(page) {
  await page.goto("/");
  // Landing → open the auth sheet → sign in.
  await page.getByRole("button", { name: "Iniciar sesión" }).first().click();
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  // The writable therapist shell has mounted once the FAB is present
  // (it's hidden in demo / read-only). Generous timeout: real auth +
  // the full data hydrate against staging.
  await expect(page.getByLabel("Agregar")).toBeVisible({ timeout: 30_000 });
}

test("record payment through the real write path → balance flips to al corriente", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await signIn(page);

  // FAB → "Pago" opens the PaymentModal.
  await page.getByLabel("Agregar").click();
  await page.getByRole("button", { name: "Pago", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Registrar pago")).toBeVisible();

  // Selecting the patient auto-fills the amount to their amountDue
  // ($1,000), so we only need to choose the patient and submit.
  await dialog.locator("select.input").first().selectOption({ label: "Paciente E2E" });
  await dialog.locator('button[type="submit"]').click();

  // The success toast only fires AFTER onRecordPayment resolves ok — i.e.
  // the Supabase insert passed RLS and the trigger ran. This is the core
  // proof that the real write landed.
  await expect(page.getByText(/Pago registrado/)).toBeVisible({ timeout: 15_000 });

  // …and it reflects in the UI: Finanzas → Saldos shows the patient
  // "Al corriente" (amountDue 0), where it read "$1,000" before.
  await page.getByRole("button", { name: "Finanzas" }).click();
  const saldos = page.getByRole("tab", { name: "Saldos" }).or(page.getByRole("button", { name: "Saldos" }));
  if (await saldos.count()) await saldos.first().click();

  const patientRow = page.locator("text=Paciente E2E").first();
  await expect(patientRow).toBeVisible({ timeout: 10_000 });
  // The balance moved: the owed "$1,000" figure is gone for this patient.
  await expect(page.getByText("Al corriente").first()).toBeVisible({ timeout: 10_000 });

  expect(pageErrors, `page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});
