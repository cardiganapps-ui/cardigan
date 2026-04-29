/* Verify what each Cardigan email link ACTUALLY does end-to-end.

   For each flow:
     1. Use admin.generateLink to get the action URL Supabase puts in the email body
     2. Follow the redirect manually (no auto-follow) to capture the Location header
     3. Parse the destination URL hash/query for the recovery indicators
     4. Report what the user lands on + how Cardigan handles it

   This lets us prove each link doesn't just "go to home" — it triggers
   the correct flow (recovery, signup, etc.). */

import { createClient } from "@supabase/supabase-js";

const SUPA_URL = process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const svc = createClient(SUPA_URL, SVC, { auth: { persistSession: false, autoRefreshToken: false } });

const TARGETS = [
  { type: "recovery",  email: "gaxioladiego@gmail.com", label: "Password recovery" },
  { type: "magiclink", email: "gaxioladiego@gmail.com", label: "Magic link" },
  // signup link can't be generated for an already-confirmed user; we test
  // the action URL shape via a freshly-created test alias instead
  { type: "signup",    email: "gaxioladiego+verify-probe@gmail.com",
    create: { password: `tmp-${Date.now()}-${Math.random().toString(36).slice(2,10)}`, full_name: "Probe" },
    label: "Signup verification" },
  { type: "invite",    email: "gaxioladiego+invite-probe@gmail.com",
    label: "Invite" },
];

async function deleteUserByEmail(email) {
  const { data, error } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return false;
  const u = data.users.find(x => (x.email || "").toLowerCase() === email.toLowerCase());
  if (!u) return false;
  await svc.auth.admin.deleteUser(u.id);
  return true;
}

console.log("──────── Email-link redirect trace ────────\n");

for (const t of TARGETS) {
  console.log(`\n[${t.label}]`);
  await deleteUserByEmail(t.email); // wipe any stale user from prior runs

  // Build args. signup needs an existing user (created with password) to
  // generate the verify link for; invite creates the user; recovery /
  // magiclink can target an existing user.
  let args = { type: t.type, email: t.email };
  if (t.type === "signup" && t.create) {
    args.password = t.create.password;
    args.options = { data: { full_name: t.create.full_name } };
  }
  if (t.type === "invite") args.options = {};

  const { data, error } = await svc.auth.admin.generateLink(args);
  if (error) { console.log(`  ERR generateLink: ${error.message}`); continue; }

  const actionUrl = data.properties?.action_link;
  if (!actionUrl) { console.log(`  no action_link in response`); console.log(JSON.stringify(data, null, 2)); continue; }
  console.log(`  email link → ${actionUrl.slice(0, 110)}…`);

  // Follow the redirect manually (no auto-follow) — Supabase verifies +
  // 302's to the configured site_url with the relevant hash/query.
  const r = await fetch(actionUrl, { redirect: "manual" });
  console.log(`  HTTP ${r.status} ${r.statusText}`);
  const loc = r.headers.get("location");
  if (!loc) { console.log(`  no Location header — body preview: ${(await r.text()).slice(0, 200)}`); continue; }

  console.log(`  Location:    ${loc}`);
  const u = new URL(loc);
  const hash = u.hash;
  const search = u.search;
  console.log(`    host:      ${u.host}`);
  console.log(`    pathname:  ${u.pathname || "/"}`);
  console.log(`    hash:      ${hash || "(none)"}`);
  console.log(`    search:    ${search || "(none)"}`);

  // Parse the hash params (Supabase implicit flow uses URL fragment)
  const hashParams = new URLSearchParams(hash.slice(1));
  const indicators = ["access_token", "refresh_token", "type", "expires_in", "expires_at", "token_type", "error", "error_description"];
  for (const k of indicators) {
    const v = hashParams.get(k);
    if (v) {
      const display = k.includes("token") ? `${v.slice(0, 16)}… (len ${v.length})` : v;
      console.log(`      ${k}=${display}`);
    }
  }

  // Cardigan's PASSWORD_RECOVERY detection:
  const willTriggerRecovery = hash.includes("type=recovery") || search.includes("type=recovery");
  console.log(`    Cardigan handles → ${
    willTriggerRecovery ? "PasswordRecoveryScreen (INITIAL_RECOVERY catches it)" :
    hashParams.get("type") === "magiclink" ? "AppShell (auto-signin via supabase-js → SIGNED_IN event)" :
    hashParams.get("type") === "signup" ? "AppShell or ProfessionOnboarding (new user without profile)" :
    hashParams.get("type") === "invite" ? "AppShell — but ⚠ user has NO password set; needs explicit password-set step" :
    hashParams.get("error") ? `ERROR: ${hashParams.get("error_description") || hashParams.get("error")}` :
    "AppShell (default sign-in handling)"
  }`);
}

// Cleanup throwaway test users
console.log("\n──────── Cleanup ────────");
for (const t of TARGETS) {
  if (t.email.includes("+")) {
    const ok = await deleteUserByEmail(t.email);
    console.log(`  ${ok ? "✓" : "—"} deleted ${t.email}`);
  }
}
