import { supabase } from "../supabaseClient";
import { SESSION_STATUS } from "../data/constants";

/**
 * Recompute a patient's denormalized counters (sessions, billed, paid)
 * from the actual sessions and payments in the database. This is the
 * source-of-truth fallback when an optimistic counter update fails.
 *
 * Invariants (see CLAUDE.md Prime Directive):
 *   sessions = total rows for this patient (includes cancelled)
 *   billed   = Σ rate over sessions where status ∈ {completed, charged}
 *              — matches the canonical amountDue formula. Older revisions
 *              counted every non-cancelled session here, which inflated
 *              billed by months of un-maintained SCHEDULED rows and
 *              disagreed with the live amountDue calc.
 *   paid     = Σ amount over all payment rows for this patient
 *
 * Returns the corrected { sessions, billed, paid } and persists them.
 * On failure returns null (caller should surface the error).
 */
export async function recalcPatientCounters(patientId) {
  const [{ data: sessRows, error: sErr }, { data: pmtRows, error: pErr }] = await Promise.all([
    supabase.from("sessions").select("rate, status").eq("patient_id", patientId),
    supabase.from("payments").select("amount").eq("patient_id", patientId),
  ]);
  if (sErr || pErr) return null;

  let sessions = 0;
  let billed = 0;
  for (const s of sessRows || []) {
    sessions++;
    if (s.status === SESSION_STATUS.COMPLETED || s.status === SESSION_STATUS.CHARGED) {
      billed += s.rate || 0;
    }
  }

  const paid = (pmtRows || []).reduce((sum, p) => sum + (p.amount || 0), 0);

  const { error } = await supabase
    .from("patients")
    .update({ sessions, billed, paid })
    .eq("id", patientId);
  if (error) return null;

  return { sessions, billed, paid };
}
