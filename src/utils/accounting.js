/* ── Accounting ── Canonical money math for Cardigan.

   ⚠️ This module implements the Prime Directive formula from CLAUDE.md.
   Any change here must keep the following invariants intact:

     consumed  = Σ(rate) over sessions that have "taken place":
                   • status = completed (explicit)
                   • status = charged   (cancel-with-charge — owed immediately,
                                         date ignored)
                   • status = scheduled AND session_datetime ≤ now
                     (auto-complete equivalent — the slot has passed so the
                     session effectively happened; therapists rarely mark
                     completions manually, and charging them for what their
                     users owe is a load-bearing piece of the product)
     amountDue = max(0, consumed − patient.paid)
     credit    = max(0, patient.paid − consumed)

   - Iterate *raw* DB sessions (the upcomingSessions state, NOT the
     enrichedSessions memo). The predicate here owns the past-scheduled
     decision; never layer enrichedSessions on top or past-scheduled
     would double-count.
   - `now` is injected so tests can pin a reference time. Defaults to
     real time.
   - rate is per-session (session.rate) with patient.rate fallback,
     preserving historical accuracy across rate changes.
   - CANCELLED (without charge) never counts.
   - SCHEDULED in the future never counts (hasn't happened yet).
*/

import { SESSION_STATUS } from "../data/constants";
import { parseShortDate } from "./dates";

// Parse a session's scheduled moment (date + time), offset by +1h so a
// session that started a moment ago but is still in-progress doesn't
// flip to "consumed" until the hour mark. Matches the display
// auto-complete rule in useCardiganData::enrichedSessions — they MUST
// agree so that a session visible as "completed" in the UI is also
// the one that appears in amountDue.
function sessionEndMoment(session) {
  const d = parseShortDate(session.date);
  if (session.time) {
    const [h, m] = session.time.split(":");
    d.setHours(parseInt(h) || 0, parseInt(m) || 0);
  }
  d.setTime(d.getTime() + 60 * 60 * 1000);
  return d;
}

// Exported so call sites can reuse the same predicate and so unit
// tests can pin it explicitly.
export function sessionCountsTowardBalance(session, now = new Date()) {
  if (!session) return false;
  if (session.status === SESSION_STATUS.COMPLETED) return true;
  if (session.status === SESSION_STATUS.CHARGED) return true;
  if (session.status === SESSION_STATUS.SCHEDULED) {
    return now >= sessionEndMoment(session);
  }
  return false;
}

/**
 * Build a map of patient_id → total consumed (sum of session rates).
 * Caller passes a rateById fallback map for sessions with a missing rate.
 * `now` is injectable so tests and batch audits can pin a reference.
 *
 * One pass over rawSessions. O(sessions).
 */
export function computeConsumedByPatient(rawSessions, rateById, now = new Date()) {
  const consumedByPatient = new Map();
  if (!rawSessions) return consumedByPatient;
  for (const s of rawSessions) {
    if (!s || !s.patient_id) continue;
    if (!sessionCountsTowardBalance(s, now)) continue;
    const fallback = rateById && rateById.get ? (rateById.get(s.patient_id) || 0) : 0;
    const rate = s.rate != null ? s.rate : fallback;
    consumedByPatient.set(
      s.patient_id,
      (consumedByPatient.get(s.patient_id) || 0) + rate
    );
  }
  return consumedByPatient;
}

/**
 * Enrich a patients list with { amountDue, credit } derived from the raw
 * session rows. Uses DB status — never the display-auto-complete state.
 *
 *   delta = consumed − paid
 *   amountDue = max(0,  delta)   // patient owes us
 *   credit    = max(0, −delta)   // patient has prepaid
 *
 * The two are mutually exclusive by construction.
 */
export function enrichPatientsWithBalance(patients, rawSessions, now = new Date()) {
  if (!patients) return [];
  const rateById = new Map(patients.map(p => [p.id, p.rate || 0]));
  const consumedByPatient = computeConsumedByPatient(rawSessions, rateById, now);
  return patients.map(p => {
    const consumed = consumedByPatient.get(p.id) || 0;
    const paid = p.paid || 0;
    const delta = consumed - paid;
    return {
      ...p,
      amountDue: Math.max(0, delta),
      credit: Math.max(0, -delta),
    };
  });
}
