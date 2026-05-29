import { supabase } from "../supabaseClient";
import { sessionCountsTowardBalance } from "./accounting";

/**
 * Recompute a patient's denormalized counters (sessions, billed, paid)
 * from the actual sessions and payments in the database. This is the
 * source-of-truth fallback when an optimistic counter update fails.
 *
 * Invariants (see CLAUDE.md Prime Directive rule #4):
 *   sessions = total rows for this patient (includes cancelled)
 *   billed   = Σ rate over sessions where sessionCountsTowardBalance(s)
 *              — the SAME canonical predicate the live amountDue calc
 *              uses (utils/accounting.js). This includes past-scheduled
 *              rows that auto-complete via the date+1h rule. Previous
 *              revisions counted only {completed, charged}, which
 *              silently DROPPED past-scheduled contributions and
 *              disagreed with the live amountDue calc.
 *   paid     = Σ amount over all payment rows for this patient
 *
 * `tz` is the user's `notification_preferences.timezone`. Without it
 * the JS predicate falls back to browser-local TZ, which diverges
 * from the SQL twin near the +1h boundary for any user whose laptop
 * isn't on their saved tz. Callers in the live UI thread it through
 * from CardiganContext (`userTz`); the audit script reads it from
 * notification_preferences per-user.
 *
 * Returns the corrected { sessions, billed, paid } and persists them.
 * On failure returns null (caller should surface the error).
 */
export async function recalcPatientCounters(patientId, tz) {
  const [{ data: sessRows, error: sErr }, { data: pmtRows, error: pErr }] = await Promise.all([
    // Predicate needs status + date + time for the past-scheduled auto-
    // complete branch. Rate sums into billed when counted.
    supabase.from("sessions").select("rate, status, date, time").eq("patient_id", patientId),
    supabase.from("payments").select("amount").eq("patient_id", patientId),
  ]);
  if (sErr || pErr) return null;

  const now = new Date();
  let sessions = 0;
  let billed = 0;
  for (const s of sessRows || []) {
    sessions++;
    if (sessionCountsTowardBalance(s, now, tz)) {
      billed += s.rate ?? 0;
    }
  }

  const paid = (pmtRows || []).reduce((sum, p) => sum + (p.amount ?? 0), 0);

  const { error } = await supabase
    .from("patients")
    .update({ sessions, billed, paid })
    .eq("id", patientId);
  if (error) return null;

  return { sessions, billed, paid };
}
