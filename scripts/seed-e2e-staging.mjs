#!/usr/bin/env node
/* ── seed-e2e-staging.mjs ──────────────────────────────────────────────
   Seeds the dedicated test account the real-auth money-write E2E
   (e2e/money-write.spec.js) signs in as, against the STAGING Supabase
   project. Idempotent: re-running resets the patient's financial rows to
   a known starting state, leaving the auth user (and its gate-clearing
   rows) intact.

   Clears every first-login gate so the spec lands straight on a writable
   Home:
     • user_profiles.profession           → skips ProfessionOnboarding
     • user_profiles.signup_source(+_at)   → skips SignupSourceStep
     • user_consents @ POLICY_VERSION      → skips ConsentBanner
     • fresh trial (created_at = now)       → writes allowed (not expired)
     • no encryption keys                   → EncryptionUnlockGate stays null

   Starting financial state for the seeded patient:
     • rate 1000, one completed past session → consumed 1000, paid 0
     • amountDue = 1000  ("$1,000 pendiente")
   The spec records a 1000 payment (→ al corriente), then deletes it
   (→ back to 1000), proving the write→trigger→read money path through
   real RLS end-to-end.

   Run:  node --env-file=.env.staging.local scripts/seed-e2e-staging.mjs
   Needs: STAGING_SUPABASE_URL, STAGING_SERVICE_ROLE, E2E_USER_EMAIL,
          E2E_USER_PASSWORD (all in .env.staging.local / CI secrets). */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.STAGING_SUPABASE_URL;
const SERVICE = process.env.STAGING_SERVICE_ROLE;
const EMAIL = process.env.E2E_USER_EMAIL;
const PASSWORD = process.env.E2E_USER_PASSWORD;

if (!URL || !SERVICE || !EMAIL || !PASSWORD) {
  console.error("Missing env. Need STAGING_SUPABASE_URL, STAGING_SERVICE_ROLE, E2E_USER_EMAIL, E2E_USER_PASSWORD.");
  process.exit(2);
}

// Keep in sync with src/data/privacy.ts::POLICY_VERSION.
const POLICY_VERSION = "2026-05-v8";
const PROFESSION = "psychologist"; // matches user_profiles.profession check (migration 021)
const PATIENT_NAME = "Paciente E2E";
const RATE = 1000;

const supabase = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const DAYS_ES = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
function daysFromNow(n) { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+n); return d; }
function shortDate(d) { return `${d.getDate()}-${MONTHS_ES[d.getMonth()]}`; }
function isoDate(d) { return d.toISOString().slice(0,10); }

async function ensureUser() {
  let userId = null, page = 1;
  while (!userId) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const m = data.users.find(u => u.email?.toLowerCase() === EMAIL.toLowerCase());
    if (m) { userId = m.id; break; }
    if (data.users.length < 100) break;
    page++;
  }
  if (userId) {
    await supabase.auth.admin.updateUserById(userId, { password: PASSWORD, email_confirm: true });
    console.log(`[seed] user exists: ${userId}`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: EMAIL, password: PASSWORD, email_confirm: true,
      user_metadata: { full_name: "E2E Writer" },
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`[seed] created user: ${userId}`);
  }
  return userId;
}

async function clearGates(userId) {
  // Profession + signup source → skips both onboarding steps.
  const { error: pErr } = await supabase.from("user_profiles").upsert(
    {
      user_id: userId,
      profession: PROFESSION,
      signup_source: "colleague",
      signup_source_recorded_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (pErr) throw new Error(`user_profiles: ${pErr.message}`);

  // Consent at the current policy version → skips ConsentBanner.
  const { error: cErr } = await supabase.from("user_consents").upsert(
    { user_id: userId, policy_version: POLICY_VERSION },
    { onConflict: "user_id,policy_version" },
  );
  if (cErr) throw new Error(`user_consents: ${cErr.message}`);
  console.log("[seed] gates cleared (profile + consent)");
}

async function resetMoneyData(userId) {
  // Wipe leaf money rows + the patient, then reseed a deterministic state.
  for (const t of ["payments", "sessions", "patients"]) {
    const { error } = await supabase.from(t).delete().eq("user_id", userId);
    if (error) throw new Error(`delete ${t}: ${error.message}`);
  }

  const { data: pat, error: insErr } = await supabase.from("patients").insert({
    user_id: userId, name: PATIENT_NAME, parent: "", phone: "5500000000",
    email: "paciente.e2e@example.com", initials: "PE", rate: RATE,
    day: "Lun", time: "10:00", color_idx: 0, scheduling_mode: "recurring",
    status: "active", start_date: isoDate(daysFromNow(-30)),
    sessions: 0, billed: 0, paid: 0,
  }).select().single();
  if (insErr) throw new Error(`insert patient: ${insErr.message}`);

  const d = daysFromNow(-7);
  const { error: sErr } = await supabase.from("sessions").insert({
    user_id: userId, patient_id: pat.id, patient: PATIENT_NAME, initials: "PE",
    time: "10:00", day: DAYS_ES[d.getDay()], date: shortDate(d), duration: 50,
    rate: RATE, modality: "presencial", session_type: "regular", is_recurring: true,
    color_idx: 0, status: "completed",
  });
  if (sErr) throw new Error(`insert session: ${sErr.message}`);

  // Reconcile counters off the seeded rows (triggers also maintain these;
  // we set them explicitly so the starting state is unambiguous).
  await supabase.from("patients").update({ sessions: 1, billed: RATE, paid: 0 }).eq("id", pat.id);
  console.log(`[seed] patient "${PATIENT_NAME}" → consumed ${RATE}, paid 0, amountDue ${RATE}`);
  return pat.id;
}

async function main() {
  console.log(`[seed] target: ${URL}`);
  const userId = await ensureUser();
  await clearGates(userId);
  await resetMoneyData(userId);
  console.log("[seed] done — e2e money-write account ready.");
}

main().catch(e => { console.error("[seed] FAILED:", e.message || e); process.exit(1); });
