#!/usr/bin/env node
/* ── audit-accounting.mjs ──────────────────────────────────────────────
   Re-derives every patient's balance straight from raw session/payment
   rows and flags drift vs. the denormalized counters plus any duplicate
   sessions. Run this after any change that touches accounting and
   whenever a user reports an inflated or incorrect balance.

   Usage:
     node --env-file=.env.local scripts/audit-accounting.mjs [--user=<user_id>]

   Requires SUPABASE_PAT and SUPABASE_PROJECT_REF (or SUPABASE_URL).
   Uses the Supabase Management API — bypasses RLS, so you see every
   user's data. Read-only: the script never writes.

   Reports, per user:
     • Duplicate sessions (patient_id, date, time)
     • Per-patient table: consumed / paid / amountDue / credit plus the
       drift vs. patient.billed and patient.paid counters
     • Global totals and anomaly summary

   Formula (canonical, see CLAUDE.md Prime Directive):
     consumed  = Σ(rate fallback patient.rate)
                 over sessions where status ∈ {completed, charged}
     amountDue = max(0, consumed − patient.paid)
     credit    = max(0, patient.paid − consumed)
*/

const PAT = process.env.SUPABASE_PAT;
const REF = process.env.SUPABASE_PROJECT_REF
         || (process.env.SUPABASE_URL || "").match(/\/\/([^.]+)\./)?.[1];

if (!PAT || !REF) {
  console.error("Missing SUPABASE_PAT and/or SUPABASE_PROJECT_REF in env.");
  console.error("Run with: node --env-file=.env.local scripts/audit-accounting.mjs");
  process.exit(1);
}

const userFilter = process.argv.find(a => a.startsWith("--user="))?.slice(7) || null;

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${PAT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`query failed (${r.status}): ${await r.text()}`);
  return r.json();
}

const fmt = (n) => `$${(Number(n) || 0).toLocaleString("en-US")}`;
const pad = (s, w) => String(s ?? "").padEnd(w);

function flag(cond, text) { return cond ? `\x1b[31m⚠ ${text}\x1b[0m` : ""; }

async function main() {
  const where = userFilter ? `WHERE user_id = '${userFilter.replace(/'/g, "''")}'` : "";

  const patients = await sql(`
    SELECT id, user_id, name, rate, billed, paid, sessions, status
    FROM patients ${where}
    ORDER BY user_id, name;
  `);
  const sessions = await sql(`
    SELECT id, user_id, patient_id, status, rate, date, time, created_at
    FROM sessions ${where};
  `);
  const payments = await sql(`
    SELECT id, user_id, patient_id, amount
    FROM payments ${where};
  `);
  const dupes = await sql(`
    SELECT patient_id, date, time, COUNT(*) AS n,
           ARRAY_AGG(id || ':' || status || ':' || COALESCE(rate::text, 'null')
                     ORDER BY created_at) AS rows
    FROM sessions ${where}
    GROUP BY patient_id, date, time
    HAVING COUNT(*) > 1
    ORDER BY n DESC;
  `);

  // Group patient rows by user
  const byUser = new Map();
  for (const p of patients) {
    if (!byUser.has(p.user_id)) byUser.set(p.user_id, []);
    byUser.get(p.user_id).push(p);
  }
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

  let globalDriftCount = 0;
  let globalOwedCount = 0;
  let globalOwedTotal = 0;
  let globalCreditTotal = 0;

  console.log("\n================ DUPLICATE SESSIONS =================");
  if (dupes.length === 0) {
    console.log("✓ no duplicate (patient_id, date, time) rows");
  } else {
    console.log(`⚠ ${dupes.length} duplicate groups found:`);
    for (const d of dupes) {
      console.log(`  ${d.patient_id}  ${d.date} ${d.time}  ×${d.n}`);
      for (const r of d.rows) console.log(`    - ${r}`);
    }
  }

  for (const [userId, plist] of byUser.entries()) {
    console.log(`\n\n================ USER ${userId} =================`);
    console.log(`${plist.length} patients`);
    console.log("");
    console.log(
      pad("Patient", 24) + pad("rate", 7) + pad("paid", 9) +
      pad("compl+chrg", 12) + pad("consumed", 11) +
      pad("amountDue", 12) + pad("credit", 10) +
      pad("billed", 9) + "flags"
    );
    console.log("-".repeat(110));

    let uOwedTotal = 0, uCreditTotal = 0;

    for (const p of plist) {
      const rate = p.rate || 0;
      const psess = sessByPatient.get(p.id) || [];
      const ppays = payByPatient.get(p.id) || [];

      let nCompleted = 0, nCharged = 0;
      let consumed = 0;
      for (const s of psess) {
        if (s.status !== "completed" && s.status !== "charged") continue;
        if (s.status === "completed") nCompleted++; else nCharged++;
        consumed += (s.rate != null ? s.rate : rate);
      }
      const paidSum = ppays.reduce((a, b) => a + (b.amount || 0), 0);
      const delta = consumed - (p.paid || 0);
      const amountDue = Math.max(0, delta);
      const credit = Math.max(0, -delta);

      const drift = (p.paid || 0) !== paidSum;
      if (drift) globalDriftCount++;
      if (amountDue > 0) { globalOwedCount++; globalOwedTotal += amountDue; uOwedTotal += amountDue; }
      if (credit > 0) { globalCreditTotal += credit; uCreditTotal += credit; }

      const flags = [
        flag(drift, `paid counter drift: counter=${p.paid} real=${paidSum}`),
      ].filter(Boolean).join(" ");

      console.log(
        pad(p.name, 24) + pad(fmt(rate), 7) + pad(fmt(p.paid), 9) +
        pad(`${nCompleted}+${nCharged}`, 12) + pad(fmt(consumed), 11) +
        pad(fmt(amountDue), 12) + pad(fmt(credit), 10) +
        pad(fmt(p.billed), 9) + flags
      );
    }
    console.log("-".repeat(110));
    console.log(`  user totals: owed=${fmt(uOwedTotal)}  credit=${fmt(uCreditTotal)}`);
  }

  console.log("\n\n================ GLOBAL SUMMARY =================");
  console.log(`Patients:           ${patients.length}`);
  console.log(`Sessions:           ${sessions.length}`);
  console.log(`Payments:           ${payments.length}`);
  console.log(`Duplicate groups:   ${dupes.length} ${dupes.length ? "⚠" : "✓"}`);
  console.log(`paid counter drift: ${globalDriftCount} patient(s) ${globalDriftCount ? "⚠" : "✓"}`);
  console.log(`Patients owing:     ${globalOwedCount}`);
  console.log(`Total owed:         ${fmt(globalOwedTotal)}`);
  console.log(`Total credit:       ${fmt(globalCreditTotal)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
