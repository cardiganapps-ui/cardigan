/* ── Compile-time financial-column contract ───────────────────────────
   The canonical amountDue formula (utils/accounting.ts) and the SQL
   predicate (session_counts_at) depend on a fixed set of columns. This
   file is TYPE-ONLY: it references those columns through the generated
   schema types, so if a migration renames or drops one — e.g. a future
   refactor that drops sessions.created_at (the C1 year-anchor) or
   patients.opening_balance (migration 078) — `tsc` fails HERE, loudly,
   before the change can silently skew every balance.

   This is the first concrete adoption of the generated types (WS-6):
   the schema is now a compile-time contract for the money columns. It
   emits no runtime code. Regenerate src/types/supabase.ts after a
   migration and this guard re-checks the new schema automatically. */

import type { Tables } from "./db";

// Sessions: the per-session inputs to the "has this been consumed?"
// predicate + the consumed-rate sum.
type _SessionFinancialColumns = {
  status: Tables<"sessions">["status"];
  date: Tables<"sessions">["date"];
  time: Tables<"sessions">["time"];
  rate: Tables<"sessions">["rate"];
  created_at: Tables<"sessions">["created_at"];
};

// Patients: the denormalized counters + opening balance that complete
// the amountDue / credit derivation.
type _PatientFinancialColumns = {
  rate: Tables<"patients">["rate"];
  paid: Tables<"patients">["paid"];
  billed: Tables<"patients">["billed"];
  opening_balance: Tables<"patients">["opening_balance"];
};

// Reference the types so unused-local rules don't strip them; the value
// itself is irrelevant — the point is that the type expressions above
// must resolve, which they only do while the columns exist.
export type FinancialColumnContract = _SessionFinancialColumns & _PatientFinancialColumns;
