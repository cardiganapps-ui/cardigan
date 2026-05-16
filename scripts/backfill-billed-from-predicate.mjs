#!/usr/bin/env node
/* ── backfill-billed-from-predicate.mjs ──────────────────────────────
   One-time helper: re-derive every patient's `billed` counter from
   raw session rows using the CANONICAL prime-directive predicate
   (utils/accounting.js::sessionCountsTowardBalance).

   Run AFTER deploying the Tier-1 fixes that align recalcPatientCounters
   and useSessions delta math with the predicate. Before that, the
   stored billed values are computed under the old "count anything not
   cancelled" rule and may diverge from the live amountDue calc.

   This script reads, computes the predicate-aligned billed, and writes
   the new value back only when it differs. Idempotent — re-running
   produces a no-op once everything is aligned.

   Usage:
     node --env-file=.env.local scripts/backfill-billed-from-predicate.mjs [--dry-run] [--user=<id>]

     --dry-run         report what would change; don't write
     --user=<id>       limit to a single user (debugging)

   Read-only outside writes. Safe to run any time. Logs every change. */

const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// Mirror parseShortDate + sessionCountsTowardBalance from src/utils so
// the backfill matches the production formula exactly. The audit
// script uses the same vendored predicate — both are intentional
// duplicates of utils/accounting.js so the off-DB tools never silently
// drift from the live calc on a future predicate change.
function parseSessionEnd(dateStr, timeStr, now) {
  if (!dateStr) return null;
  const parts = dateStr.split(/[\s-]+/);
  const day = parseInt(parts[0]);
  const mIdx = SHORT_MONTHS.indexOf(parts[1]);
  if (!day || mIdx < 0) return null;
  const refYear = now.getFullYear();
  let best = refYear, bestDiff = Infinity;
  for (const y of [refYear - 1, refYear, refYear + 1]) {
    const diff = Math.abs(new Date(y, mIdx, day) - now);
    if (diff < bestDiff) { bestDiff = diff; best = y; }
  }
  const d = new Date(best, mIdx, day);
  if (timeStr) {
    const [h, m] = timeStr.split(":");
    d.setHours(parseInt(h) || 0, parseInt(m) || 0);
  }
  d.setTime(d.getTime() + 60 * 60 * 1000);
  return d;
}
function sessionCountsTowardBalance(s, now) {
  if (s.status === "completed" || s.status === "charged") return true;
  if (s.status === "scheduled") {
    const end = parseSessionEnd(s.date, s.time, now);
    return end != null && now >= end;
  }
  return false;
}

const PAT = process.env.SUPABASE_PAT;
const REF = process.env.SUPABASE_PROJECT_REF
         || (process.env.SUPABASE_URL || "").match(/\/\/([^.]+)\./)?.[1];

if (!PAT || !REF) {
  console.error("Missing SUPABASE_PAT and/or SUPABASE_PROJECT_REF in env.");
  console.error("Run with: node --env-file=.env.local scripts/backfill-billed-from-predicate.mjs");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const userFilter = process.argv.find(a => a.startsWith("--user="))?.slice(7) || null;

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`query failed (${r.status}): ${await r.text()}`);
  return r.json();
}

function esc(s) { return String(s).replace(/'/g, "''"); }

async function main() {
  const where = userFilter ? `WHERE user_id = '${esc(userFilter)}'` : "";

  const patients = await sql(`
    SELECT id, user_id, name, rate, billed
    FROM patients ${where}
    ORDER BY user_id, name;
  `);
  const sessions = await sql(`
    SELECT patient_id, status, rate, date, time
    FROM sessions ${where};
  `);

  const sessByPatient = new Map();
  for (const s of sessions) {
    if (!sessByPatient.has(s.patient_id)) sessByPatient.set(s.patient_id, []);
    sessByPatient.get(s.patient_id).push(s);
  }

  const now = new Date();
  let changed = 0;
  let unchanged = 0;
  let totalDriftCents = 0;
  const updates = [];

  for (const p of patients) {
    const psess = sessByPatient.get(p.id) || [];
    let computed = 0;
    for (const s of psess) {
      if (!sessionCountsTowardBalance(s, now)) continue;
      computed += (s.rate != null ? s.rate : (p.rate || 0));
    }
    const current = p.billed || 0;
    if (computed === current) { unchanged++; continue; }
    changed++;
    totalDriftCents += Math.abs(computed - current);
    updates.push({ id: p.id, name: p.name, user_id: p.user_id, from: current, to: computed });
    console.log(`  ${p.user_id.slice(0,8)}… ${p.name.padEnd(30)} ${current.toString().padStart(8)} → ${computed.toString().padStart(8)}  (Δ ${(computed - current).toString().padStart(7)})`);
  }

  console.log(`\n${patients.length} patients · ${changed} drift · ${unchanged} aligned · total absolute drift ${totalDriftCents.toLocaleString("en-US")}`);

  if (dryRun) {
    console.log("\n--dry-run — no writes performed.");
    return;
  }
  if (changed === 0) {
    console.log("\nNo writes needed.");
    return;
  }

  // Write each update individually so a single bad row can't poison
  // the whole backfill. Slow on huge fleets but correct, idempotent,
  // and re-runnable.
  console.log("\nWriting updates…");
  let written = 0;
  for (const u of updates) {
    const r = await sql(`UPDATE patients SET billed = ${u.to} WHERE id = '${esc(u.id)}'`);
    if (r) written++;
  }
  console.log(`Wrote ${written} updates.`);
}

main().catch(e => { console.error(e); process.exit(1); });
