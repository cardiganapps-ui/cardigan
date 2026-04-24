/* ── Accounting ── Canonical money math for Cardigan.

   ⚠️ This module implements the Prime Directive formula from CLAUDE.md.
   Any change here must keep the following invariants intact:

     amountDue = Σ(rate) over sessions where status ∈ {completed, charged}
                 − patient.paid

   - Iterate *raw* DB sessions. Auto-completed-for-display sessions must
     NOT be passed in here — the auto-complete is a UI affordance and
     must never influence a patient's balance.
   - SCHEDULED sessions do not count (they haven't happened).
   - CANCELLED (without charge) sessions do not count.
   - rate is per-session, falling back to patient.rate when missing.
     This preserves historical accuracy when the patient's rate changes.
*/

import { SESSION_STATUS } from "../data/constants";

// A session "consumes" (contributes to amountDue) only when the therapist
// has explicitly said so: either marking it completed, or cancelling it
// with a charge. Exported so call sites can reuse the same predicate
// instead of re-deriving it.
export function sessionCountsTowardBalance(session) {
  return session.status === SESSION_STATUS.COMPLETED
      || session.status === SESSION_STATUS.CHARGED;
}

/**
 * Build a map of patient_id → total consumed (sum of session rates).
 * Caller passes a rateById fallback map for sessions with a missing rate.
 *
 * One pass over rawSessions. O(sessions).
 */
export function computeConsumedByPatient(rawSessions, rateById) {
  const consumedByPatient = new Map();
  if (!rawSessions) return consumedByPatient;
  for (const s of rawSessions) {
    if (!s || !s.patient_id) continue;
    if (!sessionCountsTowardBalance(s)) continue;
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
 * session rows (DB status — never the auto-completed display state).
 *
 *   delta = consumed − paid
 *   amountDue = max(0,  delta)   // patient owes us
 *   credit    = max(0, −delta)   // patient has prepaid
 *
 * The two are mutually exclusive by construction.
 */
export function enrichPatientsWithBalance(patients, rawSessions) {
  if (!patients) return [];
  const rateById = new Map(patients.map(p => [p.id, p.rate || 0]));
  const consumedByPatient = computeConsumedByPatient(rawSessions, rateById);
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
