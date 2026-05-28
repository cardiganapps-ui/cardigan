import { sessionCountsTowardBalance } from "./accounting";

/* ── Patient portal — pure helpers ────────────────────────────────
   Lives separate from usePatientPortalData so the helpers can be
   imported without dragging in the Supabase client (which the
   useCardiganData and friends pull in for the live-fetch path).
   That separation matters for unit tests + for any future hook
   that wants to use these classifiers without a network round-trip.

   classifySessions splits a patient's sessions into:
     - future: scheduled rows whose slot hasn't passed yet
     - past:   everything else (completed / cancelled / charged,
               OR scheduled-but-past via the auto-complete predicate)

   The patient home reads from this output to render the
   next-session hero + the past-sessions list. The auto-complete
   rule mirrors what the therapist app shows so both sides see the
   same picture. */

export function classifySessions(sessions, patientIds, nowOverride) {
  const ids = new Set(patientIds || []);
  const filtered = (sessions || []).filter((s) => ids.has(s.patient_id));
  // `nowOverride` is a Date-or-undefined; production callers always omit
  // it (real system clock). Tests pin it so the "scheduled session at
  // NOW+7 days" assertion stays stable as the calendar advances —
  // sessionCountsTowardBalance already accepts an injected `now`, so
  // forwarding the same shape here closes a long-standing gap that
  // made these tests date-sensitive.
  const now = nowOverride instanceof Date ? nowOverride : new Date();
  const future = [];
  const past = [];
  for (const s of filtered) {
    // sessionCountsTowardBalance returns true for past-1h auto-
    // completed slots. We use it to decide "this scheduled slot
    // is past" — anything else with status='scheduled' AND
    // un-passed is the actual future bucket.
    const isStrictlyFuture = s.status === "scheduled" && !sessionCountsTowardBalance(s, now);
    if (isStrictlyFuture) future.push(s);
    else past.push(s);
  }
  return { future, past };
}
