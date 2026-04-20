#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   cleanup-auto-extend.mjs — one-off cleanup for the auto-extend accounting bug.

   Background:
     Before commit 8f46d4e, useCardiganData's auto-extend had two defects
     that could create phantom past-dated `status='scheduled'` session
     rows. Those rows auto-complete in display, get summed into
     `consumed`, and inflate amountDue for sessions that never happened.
     This script identifies and deletes only the clearly-bug rows, then
     recomputes the affected patients' denormalized counters.

   Heuristic (CONSERVATIVE — may miss some artifacts to avoid false
   positives on legitimate data):
     A row is considered a bug artifact when ALL of these hold:
       1. status = 'scheduled'
       2. date is in the past (relative to today, local time)
       3. created_at is > 14 days AFTER the row's date
          (legitimate user-recorded past sessions have created_at close
          to the date; auto-extend wrote these back-filled rows long
          after the fact)
       4. It belongs to a batch of ≥3 rows inserted in the same second
          for the same patient, all past-dated and all on the same
          day-of-week (auto-extend's weekly fingerprint)

   Usage:
     DRY-RUN (default — prints a report, no writes):
       node --env-file=.env.local cleanup-auto-extend.mjs

     APPLY (actually delete + recompute):
       node --env-file=.env.local cleanup-auto-extend.mjs --apply

   Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

   After running: delete this file per the CLAUDE.md convention for
   one-off scripts.
   ─────────────────────────────────────────────────────────────────────── */

import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  console.error("Run with: node --env-file=.env.local cleanup-auto-extend.mjs [--apply]");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const MONTHS = { Ene:0, Feb:1, Mar:2, Abr:3, May:4, Jun:5, Jul:6, Ago:7, Sep:8, Oct:9, Nov:10, Dic:11 };
const DAY_MS = 86400000;

function shortToDate(short, referenceDate) {
  const s = (short || "").trim().replace(/\s+/g, "-");
  const m = s.match(/^(\d{1,2})-([A-Za-zÁÉÍÓÚ]+)$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mon = MONTHS[m[2]];
  if (mon == null) return null;
  const refYear = referenceDate.getFullYear();
  let best = null, bestDiff = Infinity;
  for (const yr of [refYear - 1, refYear, refYear + 1]) {
    const d = new Date(yr, mon, day);
    const diff = Math.abs(d.getTime() - referenceDate.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = d; }
  }
  return best;
}

function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

const today = new Date(); today.setHours(0, 0, 0, 0);
const TODAY_ISO = isoOf(today);

console.log(`[${APPLY ? "APPLY" : "DRY-RUN"}] today=${TODAY_ISO}`);
console.log("Fetching all scheduled sessions (paginated)...");

async function fetchAllScheduled() {
  const all = [];
  const page = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("sessions")
      .select("id, user_id, patient_id, patient, date, day, time, rate, created_at")
      .eq("status", "scheduled")
      .order("created_at", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < page) break;
    from += page;
  }
  return all;
}

const scheduled = await fetchAllScheduled();
console.log(`  ${scheduled.length} scheduled rows total`);

// Apply per-row filters (past-dated + gap > 14d).
const candidates = [];
for (const r of scheduled) {
  const createdAt = new Date(r.created_at);
  const dateObj = shortToDate(r.date, createdAt);
  if (!dateObj) continue;
  if (isoOf(dateObj) >= TODAY_ISO) continue;
  const gapDays = (createdAt.getTime() - dateObj.getTime()) / DAY_MS;
  if (gapDays < 14) continue;
  candidates.push({ ...r, dateObj, createdAt, gapDays });
}
console.log(`  past-dated with created_at > date+14d: ${candidates.length}`);

// Batch fingerprint: same user, same patient, same second of created_at,
// same day-of-week. Auto-extend inserts all its rows in one multi-row
// insert, so they share a created_at to the microsecond.
const groups = new Map();
for (const r of candidates) {
  const second = Math.floor(r.createdAt.getTime() / 1000);
  const dow = r.dateObj.getDay();
  const key = `${r.user_id}|${r.patient_id}|${second}|${dow}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const toDelete = [];
for (const group of groups.values()) {
  if (group.length >= 3) toDelete.push(...group);
}
console.log(`  batched ≥3 same-day-of-week same-second: ${toDelete.length}`);

// Per-user summary.
const byUser = new Map();
for (const r of toDelete) {
  if (!byUser.has(r.user_id)) byUser.set(r.user_id, { count: 0, patients: new Set(), billedImpact: 0 });
  const e = byUser.get(r.user_id);
  e.count++;
  e.patients.add(r.patient_id);
  e.billedImpact += r.rate || 0;
}

console.log("\n── Report ────────────────────────");
if (byUser.size === 0) {
  console.log("  No rows match the conservative cleanup heuristic.");
} else {
  const sorted = [...byUser.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [userId, { count, patients, billedImpact }] of sorted) {
    console.log(`  user=${userId}  rows=${count}  patients=${patients.size}  billedImpact=$${billedImpact.toLocaleString()}`);
  }
}

console.log("\n── Sample (first 15 rows) ──");
for (const r of toDelete.slice(0, 15)) {
  console.log(`  user=${r.user_id.slice(0,8)}… patient=${r.patient.padEnd(20).slice(0,20)} date=${r.date.padEnd(8)} created=${r.createdAt.toISOString().slice(0,19)} gap=${r.gapDays.toFixed(0)}d rate=$${r.rate}`);
}

if (!APPLY) {
  console.log("\n(DRY-RUN — nothing was changed. Re-run with --apply to delete + recompute.)");
  process.exit(0);
}

if (toDelete.length === 0) {
  console.log("\nNothing to do.");
  process.exit(0);
}

console.log(`\n── Applying: deleting ${toDelete.length} rows ──`);
const ids = toDelete.map(r => r.id);
const affectedPatients = new Set(toDelete.map(r => r.patient_id));
const chunkSize = 200;
for (let i = 0; i < ids.length; i += chunkSize) {
  const slice = ids.slice(i, i + chunkSize);
  const { error } = await sb.from("sessions").delete().in("id", slice);
  if (error) {
    console.error(`  delete chunk @${i} failed:`, error.message);
    process.exit(1);
  }
  console.log(`  deleted ${Math.min(i + chunkSize, ids.length)}/${ids.length}`);
}

console.log(`\n── Recomputing counters for ${affectedPatients.size} patients ──`);
let recalced = 0;
for (const pid of affectedPatients) {
  const [{ data: sessRows, error: sErr }, { data: pmtRows, error: pErr }] = await Promise.all([
    sb.from("sessions").select("rate, status").eq("patient_id", pid),
    sb.from("payments").select("amount").eq("patient_id", pid),
  ]);
  if (sErr || pErr) {
    console.error(`  patient=${pid} fetch failed:`, (sErr || pErr).message);
    continue;
  }
  let sessions = 0, billed = 0;
  for (const s of sessRows || []) {
    sessions++;
    if (s.status !== "cancelled") billed += s.rate || 0;
  }
  const paid = (pmtRows || []).reduce((sum, p) => sum + (p.amount || 0), 0);
  const { error: uErr } = await sb.from("patients").update({ sessions, billed, paid }).eq("id", pid);
  if (uErr) {
    console.error(`  patient=${pid} update failed:`, uErr.message);
    continue;
  }
  recalced++;
}
console.log(`  recalced ${recalced}/${affectedPatients.size} patients`);

console.log("\nDone.");
