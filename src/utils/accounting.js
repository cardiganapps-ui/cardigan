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
import { parseShortDate, SHORT_MONTHS, wallClockInTzToDate } from "./dates";

// Parse a session's scheduled moment (date + time), offset by +1h so a
// session that started a moment ago but is still in-progress doesn't
// flip to "consumed" until the hour mark. Matches the display
// auto-complete rule in useCardiganData::enrichedSessions — they MUST
// agree so that a session visible as "completed" in the UI is also
// the one that appears in amountDue.
//
// `tz` is the user's `notification_preferences.timezone` (IANA name).
// When provided, the moment is built as a wall clock IN THAT TZ so we
// stay in lock-step with the SQL function `public.session_counts_at`,
// which also evaluates against the saved tz (defaulting to
// "America/Mexico_City"). Without this, a therapist whose browser TZ
// differs from their saved TZ (traveling, second device in another
// zone) would see the UI-derived `amountDue` and the trigger-
// maintained `patient.billed` diverge by one rate around the +1h
// auto-complete boundary — prime-directive #4.
//
// When `tz` is undefined the function falls back to local-TZ semantics
// (parseShortDate + setHours). This preserves the pre-TZ behavior for
// callers that haven't been threaded yet, and keeps the existing unit
// tests (which run in the test-runner's TZ) green without modification.
function sessionEndMoment(session, tz, refDate) {
  if (tz) {
    const [dayStr, mon, yrStr] = session.date.split(/[\s-]+/);
    const mIdx = SHORT_MONTHS.indexOf(mon);
    const day = parseInt(dayStr) || 1;
    let year;
    if (yrStr) {
      year = 2000 + (parseInt(yrStr) || 0);
    } else {
      // Mirror parseShortDate's inferYear, but evaluated in the saved
      // tz so the year boundary call near Dec/Jan matches the SQL
      // function's `infer_short_date_year` (which also evaluates in
      // p_tz). Without this, a Mexico-City user viewing in late
      // December from a browser in early January UTC would pick
      // different years.
      const ref = refDate || new Date();
      const refY = +(new Intl.DateTimeFormat("en-US", {
        timeZone: tz, year: "numeric",
      }).format(ref));
      let bestDiff = Infinity;
      year = refY;
      for (const y of [refY - 1, refY, refY + 1]) {
        const candidate = wallClockInTzToDate(y, mIdx >= 0 ? mIdx : 0, day, 0, 0, tz);
        const diff = Math.abs(candidate - ref);
        if (diff < bestDiff) { bestDiff = diff; year = y; }
      }
    }
    let hh = 0, mm = 0;
    if (session.time) {
      const [h, m] = session.time.split(":");
      hh = parseInt(h) || 0;
      mm = parseInt(m) || 0;
    }
    const start = wallClockInTzToDate(year, mIdx >= 0 ? mIdx : 0, day, hh, mm, tz);
    return new Date(start.getTime() + 60 * 60 * 1000);
  }

  const d = parseShortDate(session.date);
  if (session.time) {
    const [h, m] = session.time.split(":");
    d.setHours(parseInt(h) || 0, parseInt(m) || 0);
  }
  d.setTime(d.getTime() + 60 * 60 * 1000);
  return d;
}

// Exported so call sites can reuse the same predicate and so unit
// tests can pin it explicitly. `tz` is optional for backward
// compatibility — production callers that have been threaded with
// `notification_preferences.timezone` should pass it; legacy callers
// fall back to local-TZ semantics until they are updated.
export function sessionCountsTowardBalance(session, now = new Date(), tz) {
  if (!session) return false;
  if (session.status === SESSION_STATUS.COMPLETED) return true;
  if (session.status === SESSION_STATUS.CHARGED) return true;
  if (session.status === SESSION_STATUS.SCHEDULED) {
    return now >= sessionEndMoment(session, tz, now);
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
export function computeConsumedByPatient(rawSessions, rateById, now = new Date(), tz) {
  const consumedByPatient = new Map();
  if (!rawSessions) return consumedByPatient;
  for (const s of rawSessions) {
    if (!s || !s.patient_id) continue;
    if (!sessionCountsTowardBalance(s, now, tz)) continue;
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
export function enrichPatientsWithBalance(patients, rawSessions, now = new Date(), tz) {
  if (!patients) return [];
  const rateById = new Map(patients.map(p => [p.id, p.rate || 0]));
  const consumedByPatient = computeConsumedByPatient(rawSessions, rateById, now, tz);
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
