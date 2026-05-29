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

// `now` is injectable so tests can pin a reference time the same way the
// rest of the accounting module already does (sessionCountsTowardBalance,
// computeConsumedByPatient). Production callers omit it and get real
// wall-clock time. Without this seam, tests that hardcode session dates
// silently break once real time drifts past the hardcoded reference.
//
// `tz` is the saved timezone (`notification_preferences.timezone`). On
// the therapist side it threads through from CardiganContext. On the
// patient side it should ride the therapist's tz (TODO — see the
// matching note in usePatientPortalData; today this falls back to
// browser-local TZ).
export function classifySessions(sessions, patientIds, now = new Date(), tz) {
  const ids = new Set(patientIds || []);
  const filtered = (sessions || []).filter((s) => ids.has(s.patient_id));
  const future = [];
  const past = [];
  for (const s of filtered) {
    // sessionCountsTowardBalance returns true for past-1h auto-
    // completed slots. We use it to decide "this scheduled slot
    // is past" — anything else with status='scheduled' AND
    // un-passed is the actual future bucket.
    const isStrictlyFuture = s.status === "scheduled" && !sessionCountsTowardBalance(s, now, tz);
    if (isStrictlyFuture) future.push(s);
    else past.push(s);
  }
  return { future, past };
}
