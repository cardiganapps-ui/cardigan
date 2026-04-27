#!/usr/bin/env node
/* ── audit-db-health.mjs ─────────────────────────────────────────────
   Daily integrity check of the production Supabase database. Catches
   the failure modes that actually bite Cardigan in practice — far
   more common than "the nightly backup didn't run":

     - A migration dropped a critical table or column.
     - RLS got turned off on a public table (e.g. via a botched
       Supabase dashboard click), opening cross-tenant reads.
     - A unique index disappeared (uniq_sessions_patient_date_time
       enforces "Never duplicate sessions" — the prime directive).
     - Duplicate sessions slipped past the index (signature of a
       schema migration bug or a bypass via service role).
     - Patient count cratered (data loss signal — investigate before
       restoring).

   Run manually:
     node --env-file=.env.local scripts/audit-db-health.mjs
   Or via cron / monitoring (UptimeRobot, GitHub Actions, etc.) —
   exits non-zero on any failure with a per-check diagnostic.

   This is NOT a restore test (which would require a second Supabase
   project to restore into — Pro plan + meaningful cost). It IS a
   structural integrity tripwire that catches drift between schema
   intent and live state. */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAT = process.env.SUPABASE_PAT;

if (!SUPABASE_URL || !SERVICE_KEY || !PAT) {
  console.error("Missing env: need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PAT.");
  console.error("Run with: node --env-file=.env.local scripts/audit-db-health.mjs");
  process.exit(2);
}

const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const REQUIRED_TABLES = [
  // Core domain
  "patients", "sessions", "payments", "notes", "documents",
  // Account & profile
  "user_profiles", "user_consents", "export_audit",
  // Notifications + cron
  "push_subscriptions", "sent_reminders", "notification_preferences",
  // Calendar feed
  "user_calendar_tokens",
  // WhatsApp
  "whatsapp_audit", "whatsapp_events",
  // Encryption
  "user_encryption_keys",
  // Measurements
  "measurements",
];

// (tablename) — must have rowsecurity = true.
const RLS_REQUIRED_TABLES = REQUIRED_TABLES;

// Key names that must exist on user_calendar_tokens / sessions etc.
const REQUIRED_INDEXES = [
  "uniq_sessions_patient_date_time",     // duplicate-session guard
  "uniq_user_calendar_tokens_hash",      // calendar token lookup
];

const issues = [];
let checks = 0;
function fail(msg) { issues.push(msg); }
async function step(name, fn) {
  checks++;
  try { await fn(); }
  catch (err) { fail(`${name}: ${err?.message || err}`); }
}

async function pgQuery(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Management API ${res.status}`);
  return await res.json();
}

// 1. Required tables exist.
await step("required tables", async () => {
  const rows = await pgQuery(`
    SELECT tablename FROM pg_tables WHERE schemaname='public'
  `);
  const present = new Set(rows.map(r => r.tablename));
  for (const t of REQUIRED_TABLES) {
    if (!present.has(t)) fail(`  missing table: ${t}`);
  }
});

// 2. RLS enabled on every public table.
await step("RLS enabled", async () => {
  const rows = await pgQuery(`
    SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'
  `);
  for (const r of rows) {
    if (RLS_REQUIRED_TABLES.includes(r.tablename) && r.rowsecurity !== true) {
      fail(`  RLS DISABLED on public.${r.tablename} — cross-tenant leak risk`);
    }
  }
});

// 3. Required unique indexes present.
await step("required indexes", async () => {
  const rows = await pgQuery(`
    SELECT indexname FROM pg_indexes WHERE schemaname='public'
  `);
  const present = new Set(rows.map(r => r.indexname));
  for (const idx of REQUIRED_INDEXES) {
    if (!present.has(idx)) fail(`  missing index: ${idx}`);
  }
});

// 4. No duplicate sessions (prime directive: never duplicate sessions).
await step("no duplicate sessions", async () => {
  const rows = await pgQuery(`
    SELECT patient_id, date, time, COUNT(*) as n
      FROM public.sessions
     WHERE status <> 'cancelled'
     GROUP BY patient_id, date, time
    HAVING COUNT(*) > 1
     LIMIT 5
  `);
  if (rows.length > 0) {
    fail(`  ${rows.length} duplicate session group(s) — run scripts/audit-accounting.mjs`);
  }
});

// 5. Patient/session counts present (sanity: not zero).
await step("non-empty patient + session tables", async () => {
  const { count: patientCount, error: pErr } = await svc
    .from("patients").select("*", { count: "exact", head: true });
  if (pErr) throw pErr;
  if ((patientCount ?? 0) === 0) {
    fail(`  patients table is EMPTY — possible data loss`);
  }
  const { count: sessionCount, error: sErr } = await svc
    .from("sessions").select("*", { count: "exact", head: true });
  if (sErr) throw sErr;
  if ((sessionCount ?? 0) === 0) {
    fail(`  sessions table is EMPTY — possible data loss`);
  }
  console.log(`  (informational) patients=${patientCount} sessions=${sessionCount}`);
});

// 6. Calendar tokens are hashed (migration 026 — never reverted).
await step("calendar tokens hashed", async () => {
  const cols = await pgQuery(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='user_calendar_tokens'
  `);
  const names = new Set(cols.map(c => c.column_name));
  if (!names.has("token_hash")) fail("  user_calendar_tokens.token_hash missing");
  if (names.has("token")) fail("  user_calendar_tokens.token column reappeared (regression?)");
});

// ── Report ──
if (issues.length) {
  console.error(`\nDB health audit FAILED (${checks} checks):\n`);
  for (const i of issues) console.error(i);
  console.error("");
  process.exit(1);
}
console.log(`\nDB health audit OK (${checks} checks).\n`);
