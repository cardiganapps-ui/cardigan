#!/usr/bin/env node
/* ── verify-e2e-staging-money.mjs ──────────────────────────────────────
   Data-layer proof that the staging Supabase project enforces the money
   path correctly — independent of the browser. Signs in as the seeded
   e2e user (real GoTrue + RLS, no service-role shortcut), records a
   $1,000 payment against "Paciente E2E", asserts the patient-counter
   trigger (trg_payments_recalc_paid) drops amountDue $1,000 → $0, then
   deletes the payment and asserts it reverts to $1,000.

   This is the same create → balance-move → delete → revert cycle the UI
   spec (e2e/money-write.spec.js) drives, but at the API layer — useful as
   a fast staging-health check when a browser isn't available (e.g. this
   container's egress can't reach external HTTPS from a headless browser).

   Run:  node --env-file=.env.staging.local scripts/verify-e2e-staging-money.mjs
   Needs: STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, E2E_USER_EMAIL,
          E2E_USER_PASSWORD. */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.STAGING_SUPABASE_URL;
const ANON = process.env.STAGING_SUPABASE_ANON_KEY;
const EMAIL = process.env.E2E_USER_EMAIL;
const PASSWORD = process.env.E2E_USER_PASSWORD;

if (!URL || !ANON || !EMAIL || !PASSWORD) {
  console.error("Missing env. Need STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, E2E_USER_EMAIL, E2E_USER_PASSWORD.");
  process.exit(2);
}

const sb = createClient(URL, ANON, { auth: { persistSession: false } });
const amountDue = (st) => Math.max(0, st.billed - st.paid);
let failures = 0;
function check(label, cond) { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) failures++; }

const { data: auth, error: aErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (aErr) { console.error("AUTH FAILED:", aErr.message); process.exit(1); }
console.log("signed in as", auth.user.email);

async function patient() {
  const { data, error } = await sb.from("patients").select("id,billed,paid").eq("name", "Paciente E2E").single();
  if (error) throw new Error("read patient: " + error.message);
  return data;
}

let p = await patient();
check(`start amountDue = 1000 (billed ${p.billed}, paid ${p.paid})`, amountDue(p) === 1000);

const { data: pay, error: insErr } = await sb.from("payments").insert({
  user_id: auth.user.id, patient_id: p.id, patient: "Paciente E2E", initials: "PE",
  amount: 1000, date: "23-Jun", method: "Transferencia", color_idx: 0,
}).select().single();
if (insErr) { console.error("INSERT FAILED:", insErr.message); process.exit(1); }
p = await patient();
check(`after payment amountDue = 0 (al corriente)`, amountDue(p) === 0);

const { error: delErr } = await sb.from("payments").delete().eq("id", pay.id);
if (delErr) { console.error("DELETE FAILED:", delErr.message); process.exit(1); }
p = await patient();
check(`after delete amountDue = 1000 (reverted)`, amountDue(p) === 1000);

await sb.auth.signOut();
console.log(failures ? `\nFAILED (${failures})` : "\nstaging money path OK");
process.exit(failures ? 1 : 0);
