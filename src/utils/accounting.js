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
     amountDue = max(0, consumed − patient.paid + patient.opening_balance)
     credit    = max(0, patient.paid − consumed − patient.opening_balance)

   - opening_balance (migration 078) is a signed MXN starting balance the
     patient was migrated in with: >0 = pre-existing debt (owes), <0 =
     saldo a favor (credit). It is NOT a session or payment row, so it
     never feeds `consumed` or `paid` — it's a standalone term in delta.
     EVERY amountDue derivation must include it (this enrich, the patient
     portal, api/_cardiTools.js, scripts/audit-accounting.mjs) or Cardi /
     the portal / the audit would disagree with the in-app number.
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

// Dev/test-only guard flag for the "raw sessions only" invariant below.
// Computed ONCE at module load. Node callers (audit-accounting.mjs,
// backfill, api/_cardiTools.js) have no `import.meta.env`, so the `&&`
// short-circuits to false there (no crash). In a Vite client production
// build `import.meta.env.DEV` folds to false, so the whole guard
// dead-code-eliminates. Only dev + vitest get the assertion.
const DISPLAY_ONLY_GUARD = !!(import.meta.env && import.meta.env.DEV);

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
    // PRIME-DIRECTIVE GUARD: accounting MUST iterate the RAW DB sessions,
    // never the display-enriched ones (useCardiganData::enrichedSessions
    // auto-completes past-scheduled rows for the UI). Feeding those here
    // would silently count months of un-maintained scheduled slots as
    // "consumed" and inflate balances. The marker is non-enumerable +
    // dev-only (invisible to spread/JSON/cache; DCE'd in prod), so this
    // throws loudly in dev/tests if anyone ever wires enrichedSessions in.
    if (DISPLAY_ONLY_GUARD && s._displayOnly) {
      throw new Error(
        "accounting received a display-only (auto-completed) session — pass raw upcomingSessions, never enrichedSessions",
      );
    }
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
 * Apply a precomputed consumed-by-patient map onto a patients list,
 * producing { amountDue, credit } per patient. This is the SINGLE home of
 * the balance delta formula:
 *
 *   delta = consumed − paid + opening_balance
 *   amountDue = max(0,  delta)   // patient owes us
 *   credit    = max(0, −delta)   // patient has prepaid
 *
 * The two are mutually exclusive by construction.
 *
 * Split out from enrichPatientsWithBalance so callers that need the two
 * stages keyed on different inputs (e.g. useCardiganData memoizes the
 * O(sessions) consumed walk on [upcomingSessions] and this cheap
 * O(patients) map on [patients]) can compose them WITHOUT duplicating the
 * formula. enrichPatientsWithBalance below is the one-shot composition.
 */
export function applyConsumedToPatients(patients, consumedByPatient) {
  if (!patients) return [];
  return patients.map(p => {
    const consumed = (consumedByPatient && consumedByPatient.get
      ? consumedByPatient.get(p.id)
      : 0) || 0;
    const paid = p.paid || 0;
    // Opening balance (migration 078): a pre-existing debt/credit the
    // patient was migrated into Cardigan with. Signed MXN — >0 = owes,
    // <0 = saldo a favor. It sits alongside consumed/paid in the delta;
    // it is NOT a session or payment, so it never enters consumed or
    // paid. Read snake_case (raw/mapped rows carry opening_balance) with
    // a camelCase fallback for any caller that pre-normalizes.
    const opening = p.opening_balance ?? p.openingBalance ?? 0;
    const delta = consumed - paid + opening;
    return {
      ...p,
      amountDue: Math.max(0, delta),
      credit: Math.max(0, -delta),
    };
  });
}

/**
 * Enrich a patients list with { amountDue, credit } derived from the raw
 * session rows. Uses DB status — never the display-auto-complete state.
 *
 * One-shot composition of the two pure stages: compute the consumed map,
 * then apply it. Kept so the many existing call sites
 * (enrichPatientsWithBalance is used across the app, the audit, and tests)
 * stay a single call. Behavior is identical to the previous inline form.
 */
export function enrichPatientsWithBalance(patients, rawSessions, now = new Date()) {
  if (!patients) return [];
  const rateById = new Map(patients.map(p => [p.id, p.rate || 0]));
  const consumedByPatient = computeConsumedByPatient(rawSessions, rateById, now);
  return applyConsumedToPatients(patients, consumedByPatient);
}
