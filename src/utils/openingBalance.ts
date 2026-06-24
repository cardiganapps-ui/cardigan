/* ── Opening-balance signing (WS-6 / Prime Directive #6) ──────────────
   A patient's opening balance (migration 078) is a single signed MXN
   integer: positive = the patient OWES us (debt), negative = saldo a favor
   (credit), 0 = none. The patient forms collect it as a positive amount + a
   direction ("owes" | "credit"); this is the one place that turns that pair
   into the signed integer the DB stores and accounting.ts reads.

   Previously duplicated verbatim in NewPatientSheet (create) and Patients
   (edit) — money rules must live in one tested helper, not be copy-pasted. */

/**
 * Sign a patient opening balance from the form's amount + direction.
 * Empty / non-numeric / non-positive amount → 0 (no opening balance), which
 * also lets the user CLEAR a previously-set balance back to 0.
 */
export function signedOpeningBalance(amount: string, dir: string): number {
  const n = Number(amount);
  if (amount === "" || !Number.isFinite(n) || n <= 0) return 0;
  return dir === "credit" ? -Math.round(n) : Math.round(n);
}
