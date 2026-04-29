#!/usr/bin/env node
/* ── audit-orphan-rows.mjs ──
   Scan every public table with a user_id column for rows pointing at
   a user_id that no longer exists in auth.users. The Apr 29 incident
   left 99 rows orphaned for ~90 minutes before anyone noticed —
   this audit catches that scenario in seconds.

   The most-important tables (patients, sessions, payments, notes,
   measurements, push_subscriptions, sent_reminders,
   notification_preferences) lack a foreign-key constraint to
   auth.users and don't cascade-delete when a user is removed (which
   is why they survive — and end up orphaned). This script is the
   closest thing to FK enforcement we have for those tables.

   Skipped intentionally:
     - account_deletions (a tombstone table; user_ids here are SUPPOSED
       to be gone from auth.users)

   Run:    npm run audit:orphans
   Or:     node --env-file=.env.local scripts/audit-orphan-rows.mjs

   Exits non-zero on any orphan rows so it can be wired into CI / a
   nightly cron alongside scripts/audit-db-health.mjs. */

const SUPA_URL = process.env.SUPABASE_URL;
const PAT = process.env.SUPABASE_PAT;

if (!SUPA_URL || !PAT) {
  console.error("Missing env. Need SUPABASE_URL and SUPABASE_PAT.");
  console.error("Run with: node --env-file=.env.local scripts/audit-orphan-rows.mjs");
  process.exit(2);
}

const REF = new URL(SUPA_URL).hostname.split(".")[0];

async function pgQuery(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Management API ${res.status}: ${await res.text()}`);
  return res.json();
}

const SKIP = new Set([
  "account_deletions", // tombstones — user_ids are supposed to be gone
]);

console.log("Scanning public tables for orphan user_id values…\n");

// Find every public table with a user_id column.
const tables = (await pgQuery(`
  SELECT table_name FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'user_id'
   ORDER BY table_name
`)).map(r => r.table_name).filter(t => !SKIP.has(t));

const orphans = [];
for (const t of tables) {
  const rows = await pgQuery(`
    SELECT user_id, COUNT(*) AS n
      FROM "${t}"
     WHERE user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = "${t}".user_id)
     GROUP BY user_id
     ORDER BY n DESC
  `);
  for (const r of rows) {
    orphans.push({ table: t, user_id: r.user_id, count: r.n });
  }
}

if (orphans.length === 0) {
  console.log(`✓ no orphan rows across ${tables.length} table${tables.length === 1 ? "" : "s"}.`);
  process.exit(0);
}

console.error(`✗ FOUND ${orphans.length} orphan groups across ${new Set(orphans.map(o => o.table)).size} tables:\n`);
const byUser = new Map();
for (const o of orphans) {
  const cur = byUser.get(o.user_id) || [];
  cur.push(o);
  byUser.set(o.user_id, cur);
}

for (const [uid, rows] of byUser) {
  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  console.error(`  user_id ${uid}  —  ${total} row${total === 1 ? "" : "s"} across ${rows.length} table${rows.length === 1 ? "" : "s"}:`);
  for (const r of rows) {
    console.error(`    ${r.table.padEnd(28)} ${String(r.count).padStart(6)} rows`);
  }
}

console.error(`
Recovery options:
  - If the user signed up again with the same email, re-link to the
    new auth.users row:
        UPDATE <table> SET user_id='<new-uuid>'
         WHERE user_id='<old-uuid>';
    (run inside a BEGIN/COMMIT for all affected tables together)
  - If the user is gone for good, delete the orphan rows:
        DELETE FROM <table> WHERE user_id='<old-uuid>';
  - If the data should never have been deletable in the first place,
    add a foreign-key constraint:
        ALTER TABLE <table>
          ADD CONSTRAINT <table>_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES auth.users(id)
          ON DELETE CASCADE;
    (sessions / patients / payments are the highest-risk tables —
    they hold real user data and currently have NO FK to auth.users.)
`);
process.exit(1);
