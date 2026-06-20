#!/usr/bin/env node
/* ── reconcile-counters.mjs ───────────────────────────────────────────
   Re-derive the THREE denormalized patient counters from raw rows and
   (optionally) write the corrected values back:

     • patient.paid     = Σ(payments.amount)                  for the patient
     • patient.billed   = Σ(rate) over predicate-consumed sessions
                          (sessionCountsTowardBalance — CLAUDE.md #4)
     • patient.sessions = COUNT(sessions)                     for the patient

   These counters are normally maintained by DB triggers (migrations 068/
   069). This is the manual recovery tool when they drift — e.g. after a
   bulk import, an out-of-band SQL edit, or an optimistic-update path that
   crashed mid-flight. The nightly `audit-accounting.mjs --strict` DETECTS
   drift; this script FIXES it.

   ⚠️  amountDue is ALWAYS re-derived live from raw sessions (utils/
   accounting.js), so these counters never affect the number a therapist
   sees — they're a cache for list sorting / quick reads. Reconciling them
   is safe by construction: we only ever set them to what the canonical
   predicate already computes. We do NOT touch sessions/payments rows, and
   we never touch opening_balance (a standalone migrated term, not a
   counter).

   SAFETY: dry-run by DEFAULT. Nothing is written unless you pass --apply.
   Idempotent — re-running after an --apply is a clean no-op.

   Usage:
     node --env-file=.env.local scripts/reconcile-counters.mjs            # dry-run (report only)
     node --env-file=.env.local scripts/reconcile-counters.mjs --apply    # write corrections
     node --env-file=.env.local scripts/reconcile-counters.mjs --user=<id>

   Requires SUPABASE_PAT and SUPABASE_PROJECT_REF (or SUPABASE_URL).
   Uses the Supabase Management API — raw SQL, bypasses RLS and the
   PostgREST max_rows cap, so it sees and reconciles every row.

   Relationship to backfill-billed-from-predicate.mjs: that earlier
   one-off reconciles billed+sessions only and writes-by-default. This
   tool supersedes it — it adds `paid`, defaults to dry-run, and is wired
   to a manual-dispatch workflow. Keep both predicate copies in sync (see
   the KEEP IN SYNC banner below). */

// Match the audit/backfill tz handling so the past-scheduled boundary is
// computed in the user's zone, not the CI runner's UTC. All current users
// are MX-tz; revisit for multi-tz support.
process.env.TZ = "America/Mexico_City";

const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// Vendored copy of parseShortDate + sessionCountsTowardBalance.
// ⚠️  KEEP IN SYNC WITH src/utils/accounting.js::sessionCountsTowardBalance,
//     scripts/audit-accounting.mjs, AND
//     scripts/backfill-billed-from-predicate.mjs (all the same predicate).
//     Node can't trivially import the Vite/JSX ESM from src/ at CLI time,
//     hence the deliberate duplication. On a predicate change: update
//     src/utils/accounting.js first, then mirror into all three scripts,
//     then re-run npm test.
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
  console.error("Run with: node --env-file=.env.local scripts/reconcile-counters.mjs");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
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
const fmt = (n) => `$${(Number(n) || 0).toLocaleString("en-US")}`;

async function main() {
  const where = userFilter ? `WHERE user_id = '${esc(userFilter)}'` : "";

  const patients = await sql(`
    SELECT id, user_id, name, rate, billed, paid, sessions
    FROM patients ${where}
    ORDER BY user_id, name;
  `);
  const sessions = await sql(`
    SELECT patient_id, status, rate, date, time
    FROM sessions ${where};
  `);
  const payments = await sql(`
    SELECT patient_id, amount
    FROM payments ${where};
  `);

  const sessByPatient = new Map();
  for (const s of sessions) {
    if (!sessByPatient.has(s.patient_id)) sessByPatient.set(s.patient_id, []);
    sessByPatient.get(s.patient_id).push(s);
  }
  const payByPatient = new Map();
  for (const p of payments) {
    if (!payByPatient.has(p.patient_id)) payByPatient.set(p.patient_id, []);
    payByPatient.get(p.patient_id).push(p);
  }

  const now = new Date();
  let changed = 0, aligned = 0;
  const updates = [];

  console.log(`\n${apply ? "APPLY" : "DRY-RUN"} — reconciling paid / billed / sessions counters\n`);

  for (const p of patients) {
    const psess = sessByPatient.get(p.id) || [];
    const ppays = payByPatient.get(p.id) || [];

    let billed = 0;
    for (const s of psess) {
      if (!sessionCountsTowardBalance(s, now)) continue;
      billed += (s.rate != null ? s.rate : (p.rate || 0));
    }
    const paid = ppays.reduce((a, b) => a + (b.amount || 0), 0);
    const sessCount = psess.length;

    const paidDrift = (p.paid || 0) !== paid;
    const billedDrift = (p.billed || 0) !== billed;
    const sessionsDrift = (p.sessions || 0) !== sessCount;

    if (!paidDrift && !billedDrift && !sessionsDrift) { aligned++; continue; }
    changed++;
    updates.push({
      id: p.id, name: p.name, user_id: p.user_id,
      paid, billed, sessCount,
      paidFrom: p.paid || 0, billedFrom: p.billed || 0, sessionsFrom: p.sessions || 0,
      paidDrift, billedDrift, sessionsDrift,
    });
    const tags = [
      paidDrift     ? `paid ${fmt(p.paid)} → ${fmt(paid)}`           : null,
      billedDrift   ? `billed ${fmt(p.billed)} → ${fmt(billed)}`     : null,
      sessionsDrift ? `sessions ${p.sessions || 0} → ${sessCount}`   : null,
    ].filter(Boolean).join("  ·  ");
    console.log(`  ${p.user_id.slice(0, 8)}… ${(p.name || "").padEnd(28)} ${tags}`);
  }

  console.log(`\n${patients.length} patients · ${changed} drift · ${aligned} aligned`);

  if (!apply) {
    console.log("\nDry-run — no writes performed. Re-run with --apply to write corrections.");
    return;
  }
  if (changed === 0) {
    console.log("\nNo writes needed — all counters already aligned.");
    return;
  }

  // Write each patient individually so one bad row can't poison the
  // batch. Only the columns that actually drifted are set, so a
  // paid-only drift never re-stamps billed/sessions.
  console.log("\nWriting corrections…");
  let written = 0;
  for (const u of updates) {
    const sets = [];
    if (u.paidDrift)     sets.push(`paid = ${u.paid}`);
    if (u.billedDrift)   sets.push(`billed = ${u.billed}`);
    if (u.sessionsDrift) sets.push(`sessions = ${u.sessCount}`);
    await sql(`UPDATE patients SET ${sets.join(", ")} WHERE id = '${esc(u.id)}'`);
    written++;
  }
  console.log(`Wrote ${written} patient row(s).`);
}

main().catch(e => { console.error(e); process.exit(1); });
