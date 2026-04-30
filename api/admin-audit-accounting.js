/* ── GET /api/admin-audit-accounting ─────────────────────────────────
   Admin-only. Re-derives every patient's balance from raw session +
   payment rows and reports drift vs. the denormalized
   patient.billed / patient.paid counters, plus duplicate-session
   detection. Mirrors scripts/audit-accounting.mjs so the live API
   answer matches what `npm run` would print.

   Returns:
     {
       runAt: ISO8601,
       totalsByUser: [{ userId, email, drift, duplicates, patientCount }],
       totals: { drift, duplicates, patientCount },
     }

   Heavy by design — scans every row in sessions + payments + patients.
   Cap on a single run is ~5s per 1k users in practice; we'll add
   pagination if/when the user base grows past that point. */

import { requireAdmin, getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";

const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

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

async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const user = await requireAdmin(req, res);
  if (!user) return;

  const svc = getServiceClient();
  const now = new Date();

  // Pull the relevant tables in parallel. We only need the columns that
  // feed the balance formula + duplicate detection.
  const [pRes, sRes, payRes, uRes] = await Promise.all([
    svc.from("patients").select("id, user_id, billed, paid, rate"),
    svc.from("sessions").select("id, user_id, patient_id, date, time, status, rate"),
    svc.from("payments").select("user_id, patient_id, amount"),
    svc.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (pRes.error) return res.status(500).json({ error: `patients: ${pRes.error.message}` });
  if (sRes.error) return res.status(500).json({ error: `sessions: ${sRes.error.message}` });
  if (payRes.error) return res.status(500).json({ error: `payments: ${payRes.error.message}` });

  const patients = pRes.data || [];
  const sessions = sRes.data || [];
  const payments = payRes.data || [];
  const users = uRes?.data?.users || [];
  const userById = new Map(users.map((u) => [u.id, u]));

  // Index sessions by patient for the consumed-vs-paid scan.
  const sessByPatient = new Map();
  // Track (patient, date, time) duplicates per user.
  const dupKey = new Map(); // key: `${user_id}::${patient_id}::${date}::${time}` → count
  for (const s of sessions) {
    const list = sessByPatient.get(s.patient_id) || [];
    list.push(s);
    sessByPatient.set(s.patient_id, list);
    const k = `${s.user_id}::${s.patient_id}::${s.date}::${s.time}`;
    dupKey.set(k, (dupKey.get(k) || 0) + 1);
  }

  // Sum payments per (user, patient).
  const paidByPatient = new Map();
  for (const p of payments) {
    const k = `${p.user_id}::${p.patient_id}`;
    paidByPatient.set(k, (paidByPatient.get(k) || 0) + Number(p.amount || 0));
  }

  // Walk patients, derive consumed + drift.
  const userTotals = new Map(); // user_id → { drift: cents, duplicates, patientCount }
  for (const p of patients) {
    const sessList = sessByPatient.get(p.id) || [];
    let consumed = 0;
    for (const s of sessList) {
      if (!sessionCountsTowardBalance(s, now)) continue;
      consumed += Number(s.rate || p.rate || 0);
    }
    const truePaid = paidByPatient.get(`${p.user_id}::${p.id}`) || 0;
    const drift = Math.abs((p.billed || 0) - consumed) + Math.abs((p.paid || 0) - truePaid);
    const slot = userTotals.get(p.user_id) || { drift: 0, duplicates: 0, patientCount: 0 };
    slot.drift += drift;
    slot.patientCount += 1;
    userTotals.set(p.user_id, slot);
  }

  for (const [key, count] of dupKey) {
    if (count <= 1) continue;
    const userId = key.split("::")[0];
    const slot = userTotals.get(userId) || { drift: 0, duplicates: 0, patientCount: 0 };
    slot.duplicates += count - 1;
    userTotals.set(userId, slot);
  }

  const totalsByUser = Array.from(userTotals.entries())
    .map(([userId, t]) => ({
      userId,
      email: userById.get(userId)?.email || null,
      drift: t.drift,
      duplicates: t.duplicates,
      patientCount: t.patientCount,
    }))
    .filter((u) => u.drift > 0 || u.duplicates > 0)
    .sort((a, b) => (b.drift + b.duplicates * 1000) - (a.drift + a.duplicates * 1000))
    .slice(0, 50);

  const grandTotals = totalsByUser.reduce(
    (acc, u) => ({
      drift: acc.drift + u.drift,
      duplicates: acc.duplicates + u.duplicates,
      patientCount: acc.patientCount + u.patientCount,
    }),
    { drift: 0, duplicates: 0, patientCount: 0 }
  );

  return res.status(200).json({
    runAt: now.toISOString(),
    flaggedUserCount: totalsByUser.length,
    totalsByUser,
    totals: grandTotals,
  });
}

export default withSentry(handler, { name: "admin-audit-accounting" });
