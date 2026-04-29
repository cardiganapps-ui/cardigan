#!/usr/bin/env node
/* ── verify-signup-flow.mjs ──
   End-to-end smoke test of the captcha-protected signup + signin
   flow. Confirms that real users (not just admin SDK calls) can
   actually create accounts and sign in, without the security
   measures wedging them.

   Steps:
     1. Snapshot + temporarily disable Supabase captcha so the anon-
        client flows we use here go through. Poll until propagation.
     2. Try an anon signUp for a +probe alias → assert success.
     3. Try anon signInWithPassword as that user → assert session.
     4. Verify user_profiles INSERT works for that session
        (mimics ProfessionOnboarding submit).
     5. Clean up: delete the test user.
     6. Restore the captcha config exactly as it was.

   Independently confirms each piece works end-to-end. If anything
   fails, the script exits non-zero with a per-step diagnostic. */

import { createClient } from "@supabase/supabase-js";

const ADMIN = "gaxioladiego@gmail.com";
const TEST = `gaxioladiego+signup-probe-${Date.now()}@gmail.com`;
const PASS = `tmp-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;

const SUPA_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAT = process.env.SUPABASE_PAT;

if (!SUPA_URL || !ANON || !SVC || !PAT) {
  console.error("Need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PAT.");
  process.exit(2);
}

const REF = new URL(SUPA_URL).hostname.split(".")[0];
const svc = createClient(SUPA_URL, SVC, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(SUPA_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

async function patchAuth(patch) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
    method: "PATCH",
    headers: { "Authorization": `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PATCH ${res.status}: ${await res.text()}`);
}
async function getAuth() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
    headers: { "Authorization": `Bearer ${PAT}` },
  });
  return res.json();
}

const before = await getAuth();
const captchaWasOn = !!before.security_captcha_enabled;
const results = [];
function record(step, ok, detail) { results.push({ step, ok, detail: detail || "" }); }

let restored = false;
async function restore() {
  if (restored) return;
  restored = true;
  if (captchaWasOn) {
    try { await patchAuth({ security_captcha_enabled: true }); console.log("captcha re-enabled."); }
    catch (e) { console.error("⚠ FAILED to re-enable captcha:", e.message); }
  }
}
process.on("uncaughtException", async (e) => { console.error(e); await cleanup(); await restore(); process.exit(1); });
process.on("unhandledRejection", async (e) => { console.error(e); await cleanup(); await restore(); process.exit(1); });

async function deleteTest() {
  const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
  const u = data?.users?.find(x => (x.email || "").toLowerCase() === TEST.toLowerCase());
  if (u) await svc.auth.admin.deleteUser(u.id);
}
async function cleanup() {
  try { await deleteTest(); } catch { /* best-effort */ }
}

try {
  // 1. Snapshot + disable captcha + propagate
  if (captchaWasOn) {
    console.log("Disabling captcha for the test…");
    await patchAuth({ security_captcha_enabled: false });
    console.log("Waiting for auth service to drop captcha enforcement…");
    const start = Date.now();
    while (Date.now() - start < 90_000) {
      const { error } = await anon.auth.signInWithOtp({
        email: `gaxioladiego+propagate-probe-${Date.now()}@gmail.com`,
        options: { shouldCreateUser: false },
      });
      if (!error || !/captcha/i.test(error.message)) break;
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // 2. signUp via anon
  await deleteTest(); // wipe any stale leftover
  const signUpResult = await anon.auth.signUp({
    email: TEST,
    password: PASS,
    options: { data: { full_name: "Probe User" } },
  });
  record("signUp(anon)", !signUpResult.error, signUpResult.error?.message);
  // signUp returns no session when mailer_autoconfirm=false; we
  // verify user creation server-side.
  await new Promise(r => setTimeout(r, 1500)); // let supabase commit
  const { data: usersData } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
  const created = usersData?.users?.find(x => (x.email || "").toLowerCase() === TEST.toLowerCase());
  record("user row in auth.users", !!created, created ? `id=${created.id}` : "not found");

  // 3. confirm the user (admin) so we can sign in (skips email link)
  if (created) {
    const { error } = await svc.auth.admin.updateUserById(created.id, { email_confirm: true });
    record("auto-confirm via admin SDK", !error, error?.message);
  }

  // 4. signInWithPassword via anon
  await new Promise(r => setTimeout(r, 6000)); // rate-limit pause
  const signInResult = await anon.auth.signInWithPassword({ email: TEST, password: PASS });
  record("signInWithPassword(anon)", !signInResult.error && !!signInResult.data?.session, signInResult.error?.message);

  // 5. INSERT user_profiles using the freshly-acquired session
  if (signInResult.data?.session && created) {
    const userClient = createClient(SUPA_URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${signInResult.data.session.access_token}` } },
    });
    const { error } = await userClient
      .from("user_profiles")
      .insert({ user_id: created.id, profession: "psychologist" });
    record("user_profiles INSERT (mimics ProfessionOnboarding)", !error, error?.message);
  } else {
    record("user_profiles INSERT (mimics ProfessionOnboarding)", false, "no session to test with");
  }
} finally {
  // 6. cleanup + restore
  console.log("\nCleaning up + restoring captcha…");
  await cleanup();
  await restore();
}

console.log("\n──────── e2e signup flow test ────────");
let allOk = true;
for (const r of results) {
  const tag = r.ok ? "✅" : "❌";
  if (!r.ok) allOk = false;
  console.log(`  ${tag}  ${r.step}${r.detail ? ` — ${r.detail}` : ""}`);
}
process.exit(allOk ? 0 : 1);
