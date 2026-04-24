#!/usr/bin/env node
/* ── backfill-daniela-sessions.mjs ─────────────────────────────────────
   One-shot: for Daniela's patients, re-create the "regular weekly session"
   rows she never logged in Cardigan. Her workflow was to only record
   cancellations / late-charges; every week where the session happened
   normally was invisible to the accounting calc and showed up as
   inflated "saldo a favor".

   For each (day, time) slot that looks recurring (≥3 sessions), this
   script enumerates weekly dates from the earliest session of that slot
   up to (and including) today, and inserts a `status='scheduled'` row
   for every date that doesn't already have a session for that patient.
   The DB's partial unique index uniq_sessions_patient_date_time acts
   as a safety net.

   Usage:
     node --env-file=.env.local scripts/backfill-daniela-sessions.mjs
     node --env-file=.env.local scripts/backfill-daniela-sessions.mjs --apply
*/

const PAT = process.env.SUPABASE_PAT;
const REF = process.env.SUPABASE_PROJECT_REF
         || (process.env.SUPABASE_URL || "").match(/\/\/([^.]+)\./)?.[1];
const APPLY = process.argv.includes("--apply");
const DANIELA_USER_ID = "4f7cf8f7-5e02-4870-98ea-24bcecc513f2";

if (!PAT || !REF) {
  console.error("Missing SUPABASE_PAT / SUPABASE_PROJECT_REF in env.");
  process.exit(1);
}

const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
// JS weekday: 0=Sun, 1=Mon, ..., 6=Sat
const DAY_TO_JS = { "Lunes":1, "Martes":2, "Miércoles":3, "Jueves":4, "Viernes":5, "Sábado":6, "Domingo":0 };

function formatShortDate(d) {
  return `${d.getDate()}-${SHORT_MONTHS[d.getMonth()]}`;
}

function parseShortDate(str, ref) {
  const parts = str.split(/[\s-]+/);
  const day = parseInt(parts[0]);
  const mIdx = SHORT_MONTHS.indexOf(parts[1]);
  if (!day || mIdx < 0) return null;
  const refYear = ref.getFullYear();
  let best = refYear, bestDiff = Infinity;
  for (const y of [refYear - 1, refYear, refYear + 1]) {
    const diff = Math.abs(new Date(y, mIdx, day) - ref);
    if (diff < bestDiff) { bestDiff = diff; best = y; }
  }
  return new Date(best, mIdx, day);
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`query failed (${r.status}): ${await r.text()}`);
  return r.json();
}

async function main() {
  const patients = await sql(
    `SELECT id, user_id, name, initials, rate, color_idx
     FROM patients
     WHERE user_id = '${DANIELA_USER_ID}' ORDER BY name;`
  );
  const sessions = await sql(
    `SELECT id, patient_id, day, time, date, status, rate
     FROM sessions
     WHERE user_id = '${DANIELA_USER_ID}';`
  );

  const byPatient = new Map();
  for (const s of sessions) {
    if (!byPatient.has(s.patient_id)) byPatient.set(s.patient_id, []);
    byPatient.get(s.patient_id).push(s);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const toInsert = [];
  const perPatientReport = [];

  for (const p of patients) {
    const psess = byPatient.get(p.id) || [];
    if (psess.length === 0) continue;

    // Group by (day, time) slot
    const slots = new Map();
    for (const s of psess) {
      const key = `${s.day}|${s.time}`;
      if (!slots.has(key)) slots.set(key, []);
      slots.get(key).push(s);
    }

    // Already-occupied dates for this patient (any time).
    // Reschedules at different times on the same date stay authoritative.
    const occupiedDates = new Set(psess.map(s => s.date));

    const patientNewRows = [];
    const skippedOneOffs = [];

    for (const [key, slotSess] of slots) {
      const [day, time] = key.split("|");

      if (slotSess.length < 3) {
        skippedOneOffs.push({ day, time, n: slotSess.length });
        continue;
      }

      const dates = slotSess.map(s => parseShortDate(s.date, today)).filter(Boolean);
      if (dates.length === 0) continue;
      const earliest = new Date(Math.min(...dates.map(d => d.getTime())));
      // Safety: earliest must fall on the slot's weekday; if not, round
      // forward to the next matching weekday so we don't insert rows on
      // the wrong day.
      const targetDow = DAY_TO_JS[day];
      const cur = new Date(earliest);
      cur.setHours(0, 0, 0, 0);
      while (cur.getDay() !== targetDow) cur.setDate(cur.getDate() + 1);

      while (cur <= today) {
        const ds = formatShortDate(cur);
        if (!occupiedDates.has(ds)) {
          patientNewRows.push({
            user_id: DANIELA_USER_ID,
            patient_id: p.id,
            patient: p.name,
            initials: p.initials,
            day, time,
            date: ds,
            duration: 60,
            rate: p.rate,
            modality: "presencial",
            color_idx: p.color_idx || 0,
            status: "scheduled",
          });
          occupiedDates.add(ds);
        }
        cur.setDate(cur.getDate() + 7);
      }
    }

    if (patientNewRows.length || skippedOneOffs.length) {
      perPatientReport.push({ name: p.name, rate: p.rate, rows: patientNewRows, skipped: skippedOneOffs });
      toInsert.push(...patientNewRows);
    }
  }

  console.log(APPLY ? "== APPLY MODE — will insert ==" : "== DRY RUN — no writes ==");
  console.log();
  for (const r of perPatientReport) {
    console.log(`${r.name} (rate $${r.rate}):`);
    if (r.rows.length === 0) console.log(`  — no missing weekly slots`);
    for (const row of r.rows) {
      console.log(`  + ${row.date.padEnd(8)} ${row.time}  ${row.day}`);
    }
    for (const s of r.skipped) {
      console.log(`  · skipped (one-off, n=${s.n}): ${s.day} ${s.time}`);
    }
    console.log();
  }
  console.log(`Total rows to insert: ${toInsert.length}`);
  console.log(`Total new consumed across Daniela's patients: $${
    toInsert.reduce((a, b) => a + (b.rate || 0), 0).toLocaleString()
  }`);

  if (!APPLY) {
    console.log("\nRe-run with --apply to actually insert.");
    return;
  }

  // Insert in one shot — normalize_short_date trigger handles date format
  // and uniq_sessions_patient_date_time prevents accidental dupes.
  if (toInsert.length === 0) { console.log("Nothing to do."); return; }

  // Build a bulk INSERT. Escape single quotes in strings.
  const esc = (s) => s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`;
  const values = toInsert.map(r =>
    `(${esc(r.user_id)},${esc(r.patient_id)},${esc(r.patient)},${esc(r.initials)},${esc(r.day)},${esc(r.time)},${esc(r.date)},${r.duration},${r.rate},${esc(r.modality)},${r.color_idx},${esc(r.status)})`
  ).join(",\n  ");
  const stmt = `INSERT INTO sessions (user_id, patient_id, patient, initials, day, time, date, duration, rate, modality, color_idx, status) VALUES\n  ${values}\n  ON CONFLICT (patient_id, date, time) WHERE patient_id IS NOT NULL DO NOTHING\n  RETURNING id;`;
  const result = await sql(stmt);
  console.log(`\n✓ Inserted ${result.length} rows (${toInsert.length - result.length} skipped by ON CONFLICT).`);
}

main().catch(e => { console.error(e); process.exit(1); });
