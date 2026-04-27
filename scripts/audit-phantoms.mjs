#!/usr/bin/env node
/* ── audit-phantoms.mjs ───────────────────────────────────────────────
   Find "phantom" recurring sessions left behind by abandoned schedule
   slots. A phantom is a past session row with `status='scheduled'`
   whose (day, time) tuple is NOT used by any FUTURE-DATED scheduled
   session for the same patient — the signature of an old recurring
   slot the user moved away from but the buggy auto-extend kept
   regenerating into the future, where it eventually aged into past.

   Why it matters (CLAUDE.md prime directive — financial integrity):
   Past sessions with `status='scheduled'` count toward `consumed` via
   the auto-complete-equivalent branch in sessionCountsTowardBalance,
   so phantom rows silently inflate amountDue.

   The auto-extend filter that produced these phantoms was fixed in
   commit 5f8a878 (PR #23). This script remains as a permanent
   operational tool for two reasons:
     1. Detect any rows that slipped through (e.g. data added by
        admin tooling, restored from backup, etc.).
     2. Catch any future regression in computeAutoExtendRows before
        the user does.

   Usage:
     node --env-file=.env.local scripts/audit-phantoms.mjs

   Read-only: reports candidates only, never writes. Decide cleanup
   per-patient — some "phantoms" may actually be legitimate one-offs
   the user manually created (extra makeup sessions, etc.). The
   script flags candidates; the human decides. */

const PAT = process.env.SUPABASE_PAT;
const SUPA_URL = process.env.SUPABASE_URL;
if (!PAT || !SUPA_URL) {
  console.error("Missing SUPABASE_PAT or SUPABASE_URL");
  process.exit(1);
}
const ref = new URL(SUPA_URL).hostname.split(".")[0];
const endpoint = `https://api.supabase.com/v1/projects/${ref}/database/query`;

async function q(sql) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    console.error(`✗ query failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  return res.json();
}

const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

/* Mirror inferYear from src/utils/dates.js: pick the closest year to
   today, since session.date is "D-MMM" without a year field. */
function shortDateToISO(str, today) {
  if (!str) return "";
  const parts = str.split(/[\s-]+/);
  const day = parseInt(parts[0]);
  const mIdx = SHORT_MONTHS.indexOf(parts[1]);
  if (!day || mIdx < 0) return "";
  let best = null;
  let bestDist = Infinity;
  for (const y of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
    const d = new Date(y, mIdx, day);
    const dist = Math.abs(d.getTime() - today.getTime());
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  if (!best) return "";
  return `${best.getFullYear()}-${String(best.getMonth() + 1).padStart(2, "0")}-${String(best.getDate()).padStart(2, "0")}`;
}

const today = new Date();
today.setHours(0, 0, 0, 0);
const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

const sessions = (await q(`
  select id, user_id, patient_id, patient, day, time, date, status, session_type, rate
  from sessions
  where status = 'scheduled'
`)).flat();

// Group by patient. For each patient, separate past (date < today)
// from future (date >= today), excluding tutor-of-minor sessions
// (those don't follow weekly recurrence — they're one-offs).
const byPatient = new Map();
for (const s of sessions) {
  if (s.session_type === "tutor") continue;
  const e = byPatient.get(s.patient_id) || { futureSlots: new Set(), past: [] };
  const iso = shortDateToISO(s.date, today);
  if (iso >= todayISO) {
    e.futureSlots.add(`${s.day}|${s.time}`);
  } else {
    e.past.push(s);
  }
  byPatient.set(s.patient_id, e);
}

// A phantom = past scheduled non-tutor row whose (day|time) doesn't
// match any of the patient's currently-scheduled future slots.
// Patients with NO future scheduled rows (ended, lapsed) are skipped
// — without a current schedule we can't say what's abandoned.
const phantoms = [];
for (const [, e] of byPatient.entries()) {
  if (e.futureSlots.size === 0) continue;
  for (const s of e.past) {
    if (e.futureSlots.has(`${s.day}|${s.time}`)) continue;
    phantoms.push({ ...s, currentSlots: [...e.futureSlots].join(", ") });
  }
}

console.log(`Total scheduled sessions: ${sessions.length}`);
console.log(`Patients with at least one future scheduled session: ${[...byPatient.values()].filter(e => e.futureSlots.size > 0).length}`);
console.log(`Suspected phantom past sessions: ${phantoms.length}`);

if (phantoms.length === 0) {
  console.log("\n✓ No phantoms detected — production is clean.");
  process.exit(0);
}

// Group by user → patient for human-readable output.
const byUser = new Map();
for (const p of phantoms) {
  const u = byUser.get(p.user_id) || { patients: new Map() };
  const pp = u.patients.get(p.patient_id) || { name: p.patient, rows: [], currentSlots: p.currentSlots };
  pp.rows.push(p);
  u.patients.set(p.patient_id, pp);
  byUser.set(p.user_id, u);
}

console.log("\nDETAILS — by user → patient → phantom rows\n");
for (const [uid, u] of byUser.entries()) {
  console.log(`USER ${uid}`);
  for (const [, pp] of u.patients.entries()) {
    const inflation = pp.rows.reduce((sum, r) => sum + (r.rate || 0), 0);
    console.log(`  ${pp.name}  (${pp.rows.length} phantom past rows, current slots: ${pp.currentSlots})`);
    if (inflation > 0) {
      console.log(`    inflated consumed by ~$${inflation.toLocaleString("es-MX")}`);
    }
    for (const r of pp.rows.slice(0, 5)) {
      console.log(`    - ${r.date} ${r.time} (${r.day}, $${r.rate || 0}) [id=${r.id}]`);
    }
    if (pp.rows.length > 5) console.log(`    … and ${pp.rows.length - 5} more`);
  }
  console.log("");
}

console.log("Cleanup is NOT performed automatically — review each candidate first.");
console.log("A row may be a legitimate one-off (manual makeup session) or a true phantom.");
