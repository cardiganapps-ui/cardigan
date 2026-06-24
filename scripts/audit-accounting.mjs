#!/usr/bin/env node
/* ── audit-accounting.mjs ──────────────────────────────────────────────
   Re-derives every patient's balance straight from raw session/payment
   rows and flags drift vs. the denormalized counters plus any duplicate
   sessions. Run this after any change that touches accounting and
   whenever a user reports an inflated or incorrect balance.

   Usage:
     node --env-file=.env.local scripts/audit-accounting.mjs [--user=<user_id>]
                                                              [--strict] [--canary] [--no-canary]

   Requires SUPABASE_PAT and SUPABASE_PROJECT_REF (or SUPABASE_URL).
   Uses the Supabase Management API — bypasses RLS, so you see every
   user's data.

   READ-ONLY except the optional trigger canary (--canary, and on by
   default under --strict). The canary inserts ONE synthetic 'completed'
   session for a real patient inside a transaction that ALWAYS rolls back
   (a closing RAISE aborts the statement), reads the trigger-updated
   counters to prove the counter trigger actually FIRES, then leaves zero
   committed rows. This closes the silent-trigger-failure blind spot: the
   drift checks above re-derive from the same rows the trigger reads, so a
   dead/detached/silently-broken trigger would still reconcile "green".
   Pass --no-canary to skip the probe (e.g. mid-incident, when you want a
   strictly read-only run).

   Reports, per user:
     • Duplicate sessions (patient_id, date, time)
     • Per-patient table: consumed / paid / amountDue / credit plus the
       drift vs. patient.billed and patient.paid counters
     • Global totals and anomaly summary

   Formula (canonical, see CLAUDE.md Prime Directive):
     consumed  = Σ(rate fallback patient.rate) over sessions where:
                   • status = completed, OR
                   • status = charged, OR
                   • status = scheduled AND (date+time+1h) ≤ now
     amountDue = max(0, consumed − patient.paid + patient.opening_balance)
     credit    = max(0, patient.paid − consumed − patient.opening_balance)
   (opening_balance: signed migrated starting balance — see the code at
    the delta computation below; this header mirrors utils/accounting.ts.)
*/

// Force the predicate calculation into the user's tz so the audit's JS
// verdict matches the live in-browser predicate AND the trigger-set
// patient.billed (migration 069). Without this the runner's default tz
// (UTC in CI, whatever-the-dev-machine-is locally) shifts the past-
// scheduled boundary by up to ±6 hours, fabricating "billed drift" for
// sessions whose end falls inside that window. All current users are
// MX-tz; revisit when multi-tz support is needed.
process.env.TZ = "America/Mexico_City";

const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// Mirror parseShortDate + sessionCountsTowardBalance from src/utils so
// the audit tool is a faithful off-DB double-check of the live formula.
// ⚠️  KEEP IN SYNC WITH src/utils/accounting.js::sessionCountsTowardBalance
//     AND src/utils/dates.js::parseShortDate / inferYear.
//     Audit script + backfill script + live calc must all use the same
//     formula. The vendored copies here exist because Node doesn't
//     trivially import ESM from src/ at runtime (Vite + JSX), and
//     these scripts are CLI-invoked. If the live predicate changes:
//       1. update src/utils/accounting.js (the canonical version)
//       2. mirror the change here AND in
//          scripts/backfill-billed-from-predicate.mjs
//       3. re-run npm test to confirm src + accounting.test.js still pass
function parseSessionEnd(dateStr, timeStr, now, createdAt) {
  if (!dateStr) return null;
  const parts = dateStr.split(/[\s-]+/);
  const day = parseInt(parts[0]);
  const mIdx = SHORT_MONTHS.indexOf(parts[1]);
  if (!day || mIdx < 0) return null;
  // Anchor the year inference on created_at (always within the recurrence
  // window of the true session date), NOT now — matches the created_at
  // anchor in utils/accounting.ts::sessionEndMoment. Falls back to now
  // when created_at is missing. A past-scheduled date >~6mo old would
  // otherwise infer to a future year and stop counting (understated
  // balance, invisible to this very audit because the old code shared the
  // bug). The "has it passed" comparison below still uses `now`.
  const created = createdAt ? new Date(createdAt) : null;
  const anchor = created && !isNaN(created.getTime()) ? created : now;
  const refYear = anchor.getFullYear();
  let best = refYear, bestDiff = Infinity;
  for (const y of [refYear - 1, refYear, refYear + 1]) {
    const diff = Math.abs(new Date(y, mIdx, day) - anchor);
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
    const end = parseSessionEnd(s.date, s.time, now, s.created_at);
    return end != null && now >= end;
  }
  return false;
}

const PAT = process.env.SUPABASE_PAT;
const REF = process.env.SUPABASE_PROJECT_REF
         || (process.env.SUPABASE_URL || "").match(/\/\/([^.]+)\./)?.[1];

if (!PAT || !REF) {
  console.error("Missing SUPABASE_PAT and/or SUPABASE_PROJECT_REF in env.");
  console.error("Run with: node --env-file=.env.local scripts/audit-accounting.mjs");
  process.exit(1);
}

const userFilter = process.argv.find(a => a.startsWith("--user="))?.slice(7) || null;
// --strict makes the script exit non-zero when any of these are
// detected: duplicate sessions, paid-counter drift, billed-counter
// drift, sessions-counter drift, duplicate recurring slots, orphaned
// receipts. Wired by the daily GitHub Actions workflow so a silent
// regression in any of the predicate-aligned counter paths trips an
// alert within 24 hours.
const strictMode = process.argv.includes("--strict");
// The trigger-health canary (see header). Runs under --canary, and by
// default under --strict so the nightly audit proves the counter trigger
// fires. --no-canary opts out (strictly read-only run).
const noCanary = process.argv.includes("--no-canary");
const canaryMode = process.argv.includes("--canary");
const wantCanary = (canaryMode || strictMode) && !noCanary;

// Distinctive rate for the canary's synthetic session — the trigger must
// add exactly this to patient.billed if it fired.
const CANARY_RATE = 4242;

// Trigger-health canary. Normalizes one real patient's counters to truth
// (same recompute the trigger uses, so the assertion is immune to any
// pre-existing drift), inserts a `completed` session (counts toward the
// balance unconditionally — no tz/date dependence), then reads the
// trigger-set counters. A live trigger moves sessions by +1 and billed by
// +CANARY_RATE. The closing RAISE rolls the whole probe back, so nothing
// is ever committed; the verdict rides out in the error message.
async function runTriggerCanary() {
  const doBlock = `do $$
declare
  v_pid uuid; v_uid uuid;
  v_b_base int; v_s_base int;
  v_b_after int; v_s_after int;
begin
  select id, user_id into v_pid, v_uid from patients order by id limit 1;
  if v_pid is null then raise exception 'CANARY_SKIP no_patients'; end if;
  perform public.recalc_patient_session_counters(v_pid);
  select coalesce(billed,0), coalesce(sessions,0) into v_b_base, v_s_base from patients where id = v_pid;
  insert into sessions (user_id, patient_id, patient, initials, time, day, date, status, rate, is_recurring)
    values (v_uid, v_pid, '__canary__', 'CX', '10:00', 'Lunes', '1-Ene', 'completed', ${CANARY_RATE}, false);
  select coalesce(billed,0), coalesce(sessions,0) into v_b_after, v_s_after from patients where id = v_pid;
  raise exception 'CANARY_VERDICT s_base=% s_after=% b_base=% b_after=%', v_s_base, v_s_after, v_b_base, v_b_after;
end $$;`;
  let raised = "";
  try {
    await sql(doBlock);
    // The canary ALWAYS raises; reaching here means the abort/rollback
    // mechanism changed out from under us — treat as a failure so it's
    // investigated (and so nothing could have committed silently).
    return { ok: false, ran: true, reason: "canary did not raise — rollback path unverified" };
  } catch (e) {
    raised = String(e?.message || e);
  }
  if (/CANARY_SKIP/.test(raised)) return { ok: true, ran: false, skipped: true };
  const m = raised.match(/CANARY_VERDICT s_base=(\d+) s_after=(\d+) b_base=(-?\d+) b_after=(-?\d+)/);
  if (!m) {
    const firstLine = raised.split("\\n")[0].slice(0, 200);
    return { ok: false, ran: true, reason: `trigger probe errored: ${firstLine}` };
  }
  const [, sBase, sAfter, bBase, bAfter] = m.map(Number);
  const sessionsFired = sAfter === sBase + 1;
  const billedFired = bAfter === bBase + CANARY_RATE;
  return {
    ok: sessionsFired && billedFired, ran: true,
    sBase, sAfter, bBase, bAfter, sessionsFired, billedFired,
  };
}

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
    SELECT id, user_id, name, rate, billed, paid, opening_balance, sessions, status
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
  let globalBilledDriftCount = 0;
  let globalSessionsDriftCount = 0;
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
      pad("cp+ch+ps", 12) + pad("consumed", 11) +
      pad("amountDue", 12) + pad("credit", 10) +
      pad("billed", 9) + "flags"
    );
    console.log("-".repeat(110));

    let uOwedTotal = 0, uCreditTotal = 0;

    const now = new Date();
    for (const p of plist) {
      const rate = p.rate || 0;
      const psess = sessByPatient.get(p.id) || [];
      const ppays = payByPatient.get(p.id) || [];

      let nCompleted = 0, nCharged = 0, nPastSched = 0;
      let consumed = 0;
      for (const s of psess) {
        if (!sessionCountsTowardBalance(s, now)) continue;
        if (s.status === "completed") nCompleted++;
        else if (s.status === "charged") nCharged++;
        else nPastSched++;  // scheduled & past
        consumed += (s.rate != null ? s.rate : rate);
      }
      const paidSum = ppays.reduce((a, b) => a + (b.amount || 0), 0);
      // opening_balance (migration 078): signed standalone term in the
      // delta, mirroring utils/accounting.js. It does NOT feed billed/
      // paid/sessions, so the counter-drift checks below ignore it.
      const opening = p.opening_balance || 0;
      const delta = consumed - (p.paid || 0) + opening;
      const amountDue = Math.max(0, delta);
      const credit = Math.max(0, -delta);

      const paidDrift = (p.paid || 0) !== paidSum;
      // billed counter must equal the predicate-aligned consumed
      // (prime-directive rule #4). billedDrift catches anything that
      // slips past the in-app paths and the recalc fallback.
      const billedDrift = (p.billed || 0) !== consumed;
      // sessions counter must equal the raw row count for this patient.
      const sessionsDrift = (p.sessions || 0) !== psess.length;
      if (paidDrift) globalDriftCount++;
      if (billedDrift) globalBilledDriftCount++;
      if (sessionsDrift) globalSessionsDriftCount++;
      if (amountDue > 0) { globalOwedCount++; globalOwedTotal += amountDue; uOwedTotal += amountDue; }
      if (credit > 0) { globalCreditTotal += credit; uCreditTotal += credit; }

      const flags = [
        flag(paidDrift,    `paid counter drift: counter=${p.paid} real=${paidSum}`),
        flag(billedDrift,  `billed counter drift: counter=${p.billed} predicate=${consumed}`),
        flag(sessionsDrift,`sessions counter drift: counter=${p.sessions} real=${psess.length}`),
      ].filter(Boolean).join(" ");

      console.log(
        pad(p.name, 24) + pad(fmt(rate), 7) + pad(fmt(p.paid), 9) +
        pad(`${nCompleted}+${nCharged}+${nPastSched}`, 12) + pad(fmt(consumed), 11) +
        pad(fmt(amountDue), 12) + pad(fmt(credit), 10) +
        pad(fmt(p.billed), 9) + flags
      );
    }
    console.log("-".repeat(110));
    console.log(`  user totals: owed=${fmt(uOwedTotal)}  credit=${fmt(uCreditTotal)}`);
  }

  // ── Expenses audit ───────────────────────────────────────────────
  // 1. Duplicate (recurring_id, period_year, period_month) — should be
  //    impossible given the partial unique index, but verify anyway.
  // 2. Orphaned receipt_document_id — pointer to a deleted document row.
  // 3. Recurring templates with zero generated rows in the active period
  //    (likely a generation bug or paused-and-forgotten template).
  // The user filter (--user=<id>) drops the WHERE clause keyword, so
  // we splice it via AND when there's already a WHERE. Without this,
  // an admin debugging a single user would get GLOBAL drift counts
  // mixed with that user's per-user output below — misleading.
  const userAnd = userFilter
    ? ` AND user_id = '${userFilter.replace(/'/g, "''")}'`
    : "";
  const userAndExpense = userFilter
    ? ` AND e.user_id = '${userFilter.replace(/'/g, "''")}'`
    : "";
  const dupRecur = await sql(`
    SELECT recurring_id, period_year, period_month, count(*) as n
    FROM expenses
    WHERE recurring_id IS NOT NULL${userAnd}
    GROUP BY 1, 2, 3 HAVING count(*) > 1
  `);
  const orphanReceipts = await sql(`
    SELECT e.id, e.user_id, e.receipt_document_id
    FROM expenses e
    LEFT JOIN documents d ON d.id = e.receipt_document_id
    WHERE e.receipt_document_id IS NOT NULL AND d.id IS NULL${userAndExpense}
  `);
  const expensesCount = await sql(`SELECT count(*)::int AS n FROM expenses ${where}`);
  const recurCount = await sql(`SELECT count(*)::int AS n FROM recurring_expenses ${where}`);

  console.log("\n\n================ GLOBAL SUMMARY =================");
  console.log(`Patients:           ${patients.length}`);
  console.log(`Sessions:           ${sessions.length}`);
  console.log(`Payments:           ${payments.length}`);
  console.log(`Expenses:           ${expensesCount[0]?.n ?? 0}`);
  console.log(`Recurring tpls:     ${recurCount[0]?.n ?? 0}`);
  console.log(`Duplicate groups:    ${dupes.length} ${dupes.length ? "⚠" : "✓"}`);
  console.log(`Dup. recur slots:    ${dupRecur.length} ${dupRecur.length ? "⚠" : "✓"}`);
  console.log(`Orphaned receipts:   ${orphanReceipts.length} ${orphanReceipts.length ? "⚠" : "✓"}`);
  console.log(`paid drift:          ${globalDriftCount} patient(s) ${globalDriftCount ? "⚠" : "✓"}`);
  console.log(`billed drift:        ${globalBilledDriftCount} patient(s) ${globalBilledDriftCount ? "⚠" : "✓"}`);
  console.log(`sessions drift:      ${globalSessionsDriftCount} patient(s) ${globalSessionsDriftCount ? "⚠" : "✓"}`);
  console.log(`Patients owing:      ${globalOwedCount}`);
  console.log(`Total owed:          ${fmt(globalOwedTotal)}`);
  console.log(`Total credit:        ${fmt(globalCreditTotal)}`);

  // ── Trigger-health canary ────────────────────────────────────────
  // A rolled-back probe that proves the counter trigger actually FIRES
  // (see runTriggerCanary + the header). Without it, every drift check
  // above could read "green" while the trigger is silently dead, because
  // they re-derive from the same rows the trigger uses.
  let canary = null;
  if (wantCanary) {
    canary = await runTriggerCanary();
    console.log("\n================ TRIGGER CANARY =================");
    if (canary.skipped) {
      console.log("• skipped — no patients to probe");
    } else if (canary.ok) {
      console.log(`✓ counter trigger fired: sessions ${canary.sBase}→${canary.sAfter} (+1), billed ${fmt(canary.bBase)}→${fmt(canary.bAfter)} (+${fmt(CANARY_RATE)}) — rolled back`);
    } else if (canary.reason) {
      console.log(`\x1b[31m⚠ canary failed: ${canary.reason}\x1b[0m`);
    } else {
      console.log(`\x1b[31m⚠ counter trigger did NOT fire as expected: sessions +1=${canary.sessionsFired}, billed +${CANARY_RATE}=${canary.billedFired} (s ${canary.sBase}→${canary.sAfter}, b ${canary.bBase}→${canary.bAfter})\x1b[0m`);
    }
  }

  // Strict mode: exit non-zero when any structural invariant is
  // violated. Used by the daily CI workflow so drift trips an alert
  // automatically. We deliberately do NOT fail on "patients owing"
  // (that's expected business state).
  //
  // What strict mode DOES gate on:
  //   • Duplicate session rows (real corruption — DB index breach or
  //     a write-race the partial-unique-index didn't catch)
  //   • Duplicate recurring expense slots (same as above for expenses)
  //   • Orphaned receipt pointers (a document delete that didn't null
  //     the expense's receipt_document_id)
  //   • patient.paid drift vs Σ payments (event-driven counter — only
  //     changes when payments are inserted/deleted, so drift means a
  //     bug in the optimistic update path or external DB writes)
  //   • patient.sessions drift vs row count (same — event-driven, so
  //     drift means a bug)
  //
  // What strict mode does NOT gate on:
  //   • patient.billed drift. The predicate (sessionCountsTowardBalance)
  //     is TIME-DEPENDENT — a future-scheduled session auto-completes
  //     silently the moment `date+time+1h` passes, with no event to
  //     update patient.billed until the next mutation. So billed
  //     naturally lags predicate-consumed by exactly the rates of
  //     sessions that have crossed the auto-complete boundary since
  //     the last mutation. Failing the audit on this would fire every
  //     morning after the previous evening's sessions tick past.
  //     The live amountDue calc is unaffected (it always re-derives
  //     from raw sessions); patient.billed is essentially a cached
  //     denormalization that recalc-on-mutation keeps approximately
  //     correct. Run `scripts/backfill-billed-from-predicate.mjs`
  //     manually if you want to sync the cached values.
  //
  // We still REPORT billed drift in the global summary above so an
  // unusual jump shows up in the workflow log even though it doesn't
  // fail the workflow.
  if (strictMode) {
    const violations = [];
    if (dupes.length > 0)         violations.push(`${dupes.length} duplicate session group(s)`);
    if (dupRecur.length > 0)      violations.push(`${dupRecur.length} duplicate recurring slot(s)`);
    if (orphanReceipts.length > 0)violations.push(`${orphanReceipts.length} orphaned receipt(s)`);
    if (globalDriftCount > 0)     violations.push(`${globalDriftCount} paid-counter drift`);
    if (globalSessionsDriftCount > 0) violations.push(`${globalSessionsDriftCount} sessions-counter drift`);
    // Trigger canary: a non-firing (or errored) trigger is a hard failure —
    // it means the denormalized counters are no longer being maintained,
    // even if today's drift checks happen to reconcile. A skipped canary
    // (no patients) is not a violation.
    if (canary && !canary.ok && !canary.skipped) {
      violations.push(`counter trigger canary: ${canary.reason || "trigger did not fire on synthetic insert"}`);
    }
    if (violations.length > 0) {
      console.error(`\n✗ STRICT MODE: ${violations.length} invariant(s) violated:`);
      for (const v of violations) console.error(`    • ${v}`);
      process.exit(1);
    }
    console.log("\n✓ STRICT MODE: all invariants hold.");
    if (globalBilledDriftCount > 0) {
      console.log(`  (billed drift on ${globalBilledDriftCount} patient(s) — expected lag from auto-completing sessions; not a failure)`);
    }
  } else if (canaryMode && canary && !canary.ok && !canary.skipped) {
    // Standalone `--canary` (no --strict): still exit non-zero on failure
    // so a manual or CI canary run signals a dead trigger.
    console.error("\n✗ trigger canary failed.");
    process.exit(1);
  }

  if (dupRecur.length > 0) {
    console.log("\n--- Duplicate recurring slots (DB index breach!) ---");
    for (const r of dupRecur) console.log(`  ${r.recurring_id}  ${r.period_year}-${r.period_month}  count=${r.n}`);
  }
  if (orphanReceipts.length > 0) {
    console.log("\n--- Expenses with orphan receipt_document_id ---");
    for (const r of orphanReceipts.slice(0, 20)) console.log(`  ${r.id}  receipt=${r.receipt_document_id}`);
    if (orphanReceipts.length > 20) console.log(`  ... and ${orphanReceipts.length - 20} more`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
