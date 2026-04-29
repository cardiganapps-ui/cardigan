#!/usr/bin/env node
/* ── send-email-samples.mjs ──
   Trigger one of every email Cardigan can send so the admin can test
   each link end-to-end. Sends to gaxioladiego@gmail.com (admin) and
   plus-aliases of the same address for flows that need a fresh user.

   Run:  node --env-file=.env.local scripts/send-email-samples.mjs

   Steps:
     1. Temporarily disable Supabase captcha so the anon-client flows
        (signUp, signInWithOtp, resetPasswordForEmail, resend) go
        through without a Turnstile token.
     2. Fire each email:
          - Password recovery  → real admin email
          - Magic link         → real admin email
          - Signup verify      → +test-signup alias (test user created)
          - Resend signup      → same +test-signup alias
          - Invite             → +test-invite alias (test user created)
          - Data-export notice → real admin email (sent via Resend)
     3. Delete the throwaway test users.
     4. Re-enable captcha.

   Skipped intentionally:
     - Email change confirmation (mutates the admin's actual email)
     - Reauthentication (Cardigan doesn't use this flow)
     - MFA factor enrolled / unenrolled (only fire on real enrollment)
     - email_changed / phone_changed / password_changed notifications
       (system messages from Supabase post-action, not triggerable
       independently). */

import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "gaxioladiego@gmail.com";
const TEST_SIGNUP = "gaxioladiego+test-signup@gmail.com";
const TEST_INVITE = "gaxioladiego+test-invite@gmail.com";
const TEST_PASSWORD = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const SUPA_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAT = process.env.SUPABASE_PAT;
const RESEND = process.env.RESEND_API_KEY;

if (!SUPA_URL || !SVC || !PAT) {
  console.error("Missing env. Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PAT.");
  process.exit(2);
}
if (!ANON) console.warn("⚠ SUPABASE_ANON_KEY not set — anon-client flows will be skipped.");
if (!RESEND) console.warn("⚠ RESEND_API_KEY not set — data-export notice will be skipped.");

const REF = new URL(SUPA_URL).hostname.split(".")[0];
const svc = createClient(SUPA_URL, SVC, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = ANON ? createClient(SUPA_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || "" });
}

async function patchAuthConfig(patch) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
    method: "PATCH",
    headers: { "Authorization": `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`auth config PATCH ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchAuthConfig() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
    headers: { "Authorization": `Bearer ${PAT}` },
  });
  if (!res.ok) throw new Error(`auth config GET ${res.status}`);
  return res.json();
}

async function deleteUserByEmail(email) {
  // listUsers paginates; for a test email this is the simplest cleanup.
  const { data, error } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return false;
  const u = data.users.find(x => (x.email || "").toLowerCase() === email.toLowerCase());
  if (!u) return false;
  await svc.auth.admin.deleteUser(u.id);
  return true;
}

// ── 0. snapshot + disable captcha ──
console.log("Reading current auth config…");
const before = await fetchAuthConfig();
const captchaWasOn = !!before.security_captcha_enabled;
const captchaProvider = before.security_captcha_provider;
const captchaSecret = before.security_captcha_secret; // hashed on read but may still be present

if (captchaWasOn) {
  console.log("Disabling captcha for the duration…");
  await patchAuthConfig({ security_captcha_enabled: false });
  // Supabase Auth caches the captcha config — the PATCH lands instantly
  // in the project config but the auth service can take ~30s to pick up
  // the change. Poll a fast public endpoint and wait until a captcha-
  // requiring call goes through (or give up after 90s).
  console.log("Waiting for captcha to actually drop on the auth side…");
  const probeAnon = createClient(SUPA_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    const { error } = await probeAnon.auth.signInWithOtp({
      email: `gaxioladiego+probe-${Date.now()}@gmail.com`,
      options: { shouldCreateUser: false },
    });
    // We expect either "User not found" (captcha cleared, request reached the user lookup)
    // or success. Anything except the captcha error means we're through.
    if (!error) break;
    if (!/captcha/i.test(error.message)) break;
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log("Captcha-side propagation complete.");
}

// Restore captcha no matter what fails.
async function restoreCaptcha() {
  if (!captchaWasOn) return;
  try {
    await patchAuthConfig({ security_captcha_enabled: true });
    console.log("✓ captcha re-enabled");
  } catch (e) {
    console.error("⚠ FAILED to re-enable captcha — DO IT MANUALLY in the Supabase dashboard.", e);
  }
}
process.on("uncaughtException", async (e) => { console.error(e); await restoreCaptcha(); process.exit(1); });
process.on("unhandledRejection", async (e) => { console.error(e); await restoreCaptcha(); process.exit(1); });

try {
  // ── 1. password recovery (admin's real email) ──
  if (anon) {
    const { error } = await anon.auth.resetPasswordForEmail(ADMIN_EMAIL);
    record("Password recovery → admin email", !error, error?.message);
  } else {
    record("Password recovery → admin email", false, "no anon key");
  }

  // ── 2. magic link (admin's real email) ──
  // Supabase rate-limits same-email requests to one every ~4s. Pause
  // before firing the next one to the same recipient.
  await new Promise(r => setTimeout(r, 6000));
  if (anon) {
    const { error } = await anon.auth.signInWithOtp({
      email: ADMIN_EMAIL,
      options: { shouldCreateUser: false },
    });
    record("Magic link → admin email", !error, error?.message);
  } else {
    record("Magic link → admin email", false, "no anon key");
  }

  // ── 3. signup verification (+ test alias) ──
  await deleteUserByEmail(TEST_SIGNUP); // wipe stale leftover from previous runs
  if (anon) {
    const { error } = await anon.auth.signUp({
      email: TEST_SIGNUP,
      password: TEST_PASSWORD,
      options: { data: { full_name: "Test Signup" } },
    });
    record(`Signup verification → ${TEST_SIGNUP}`, !error, error?.message);

    // ── 4. resend signup verification (same alias) — rate-limit pause
    await new Promise(r => setTimeout(r, 6000));
    const { error: e2 } = await anon.auth.resend({ type: "signup", email: TEST_SIGNUP });
    record(`Resend signup verification → ${TEST_SIGNUP}`, !e2, e2?.message);
  } else {
    record(`Signup verification → ${TEST_SIGNUP}`, false, "no anon key");
    record(`Resend signup verification → ${TEST_SIGNUP}`, false, "no anon key");
  }

  // ── 5. invite (+ another test alias) ──
  await deleteUserByEmail(TEST_INVITE); // wipe stale leftover
  const { error: invErr } = await svc.auth.admin.inviteUserByEmail(TEST_INVITE);
  record(`Invite → ${TEST_INVITE}`, !invErr, invErr?.message);

  // ── 6. data-export notice (Resend direct) ──
  if (RESEND) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Cardigan <no-reply@cardigan.mx>",
        to: [ADMIN_EMAIL],
        subject: "[SAMPLE] Descargaste una copia de tus datos en Cardigan",
        html: `
          <p>Hola,</p>
          <p>Acabas de descargar una copia de tus datos desde Cardigan.</p>
          <p>Si fuiste tú, no necesitas hacer nada más. Si no reconoces esta actividad,
          cambia tu contraseña inmediatamente desde Ajustes y contáctanos en
          <a href="mailto:privacy@cardigan.mx">privacy@cardigan.mx</a>.</p>
          <p>— Cardigan</p>
          <hr><p style="color:#888;font-size:12px">This is a sample from scripts/send-email-samples.mjs.</p>
        `,
      }),
    });
    record(`Data-export notice → admin email`, r.ok, r.ok ? "" : await r.text());
  } else {
    record(`Data-export notice → admin email`, false, "no Resend key");
  }
} finally {
  // ── cleanup throwaway test users ──
  // Wait a beat so Supabase doesn't fail the delete because the row is
  // still propagating from the signup we just did.
  await new Promise(r => setTimeout(r, 1500));
  try { await deleteUserByEmail(TEST_SIGNUP); } catch (e) { console.warn("could not delete test signup:", e.message); }
  try { await deleteUserByEmail(TEST_INVITE); } catch (e) { console.warn("could not delete test invite:", e.message); }

  await restoreCaptcha();
}

// ── report ──
console.log("\n──────── Email sample run ────────");
for (const r of results) {
  const tag = r.ok ? "✅" : "❌";
  console.log(`  ${tag}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log("\nCheck your inbox + spam folder. Test users have been deleted.");
console.log("Skipped intentionally: email-change, reauthentication, MFA-enrolled/unenrolled, password-changed system notice.");
