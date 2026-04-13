import { supabase } from "../supabaseClient";
import { SESSION_STATUS } from "../data/constants";

/**
 * Recompute a patient's denormalized counters (sessions, billed, paid) from
 * the actual sessions and payments in the database. This is the source-of-truth
 * fallback when an optimistic counter update fails.
 *
 * Returns the corrected { sessions, billed, paid } and persists them to the DB.
 * On failure returns null (caller should surface the error).
 */
export async function recalcPatientCounters(patientId) {
  const [{ data: sessRows, error: sErr }, { data: pmtRows, error: pErr }] = await Promise.all([
    supabase.from("sessions").select("rate, status").eq("patient_id", patientId),
    supabase.from("payments").select("amount").eq("patient_id", patientId),
  ]);
  if (sErr || pErr) return null;

  // sessions = count of non-cancelled sessions; billed = sum of their rates
  let sessions = 0;
  let billed = 0;
  for (const s of sessRows || []) {
    if (s.status !== SESSION_STATUS.CANCELLED) {
      sessions++;
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
