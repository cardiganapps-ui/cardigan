/* ── Recurring-session generation helpers ──

   Pure functions used by useSessions (initial generation, schedule
   change) and useCardiganData (auto-extend on login). Kept React-free
   so they can be unit-tested without the supabase client or any UI
   surface — the auto-extend logic in particular is critical for
   accounting integrity (its bugs inflated amountDue for sessions that
   never happened) and must stay covered by tests.
*/

import { PATIENT_STATUS, SESSION_STATUS } from "../data/constants";
import { isTutorSession } from "./sessions";
import { formatShortDate, parseLocalDate, parseShortDate, shortDateToISO, toISODate } from "./dates";
import { RECURRENCE_WINDOW_WEEKS } from "../data/constants";

const DAY_TO_JS = { "Lunes":1, "Martes":2, "Miércoles":3, "Jueves":4, "Viernes":5, "Sábado":6, "Domingo":0 };

/**
 * Weekly date series for `dayName` from `startDateStr` (inclusive) to
 * `endDateStr` (inclusive). Both inputs are ISO dates ("YYYY-MM-DD"). If
 * `endDateStr` is omitted, defaults to RECURRENCE_WINDOW_WEEKS past start.
 */
export function getRecurringDates(dayName, startDateStr, endDateStr) {
  const target = DAY_TO_JS[dayName];
  if (target == null) return [];
  const start = parseLocalDate(startDateStr);
  let diff = target - start.getDay();
  if (diff < 0) diff += 7;
  const end = endDateStr ? parseLocalDate(endDateStr) : new Date(start);
  if (!endDateStr) end.setDate(end.getDate() + RECURRENCE_WINDOW_WEEKS * 7);
  const dates = [];
  const current = new Date(start);
  current.setDate(start.getDate() + diff);
  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 7);
  }
  return dates;
}

/**
 * Decide which session rows to insert when auto-extending a patient's
 * recurring schedule. Pure — returns rows ready to insert (or `[]`).
 *
 * Accounting invariants enforced here:
 *   1. NEVER generate a session with a date in the past. Past-dated
 *      sessions auto-complete in display, get summed into `consumed`,
 *      and inflate amountDue for sessions that never happened. The
 *      window therefore starts at max(latest+1day, today).
 *   2. The "current" recurring schedule is reflected ONLY in
 *      currently-scheduled, non-tutor sessions. Walking historical
 *      rows pulled in abandoned slots (after a Mon→Wed schedule
 *      change) and one-off tutor day/times, both of which caused
 *      duplicate weekly sessions on slots the patient no longer uses.
 *
 * Inputs:
 *   patient    — the patient row
 *   allPSess   — all sessions for that patient (any status, any date)
 *   today      — Date at midnight, the floor for generated dates
 *   threshold  — Date; if latest scheduled session is later than this,
 *                the schedule isn't running out yet → no extend
 *   extendEnd  — ISO date string; the upper bound for new sessions
 *   userId     — user_id to stamp on inserted rows
 */
export function computeAutoExtendRows({ patient, allPSess, today, threshold, extendEnd, userId }) {
  if (!patient || patient.status !== PATIENT_STATUS.ACTIVE) return [];
  // Episodic patients have no perpetual weekly slot — the practitioner
  // schedules the next visit at the end of each consult. Defensive
  // guard that mirrors the call-site filter in useCardiganData; cheaper
  // here than scanning allPSess for is_recurring=true rows.
  if (patient.scheduling_mode === "episodic") return [];
  if (!Array.isArray(allPSess) || allPSess.length === 0) return [];

  // CRITICAL — see CLAUDE.md prime directive on financial integrity.
  //
  // The patient's "current recurring schedule" is the set of (day,
  // time) tuples found in FUTURE-DATED scheduled sessions only.
  //
  // Why the date filter matters:
  //   - Auto-complete is display-only (CLAUDE.md). Past sessions
  //     whose `date < today` keep `status='scheduled'` in the DB
  //     even though the UI renders them as completed.
  //   - When a user moves a patient from Lunes to Miércoles,
  //     applyScheduleChange deletes FUTURE Mondays but PAST Mondays
  //     remain in the DB as status='scheduled' (auto-display
  //     completed). Without this date filter they'd leak into
  //     `schedMap` and auto-extend would regenerate phantom future
  //     Mondays — and those phantoms eventually become past, count
  //     toward `consumed`, and silently inflate amountDue.
  //   - Tutor sessions are also excluded so a one-off appointment
  //     with a parent doesn't mint weekly recurrences on that day.
  const todayISOStr = toISODate(today);
  const scheduledRegular = allPSess.filter(s => {
    if (s.status !== SESSION_STATUS.SCHEDULED) return false;
    if (isTutorSession(s)) return false;
    if (shortDateToISO(s.date) < todayISOStr) return false;
    // is_recurring is the explicit "this row was created as part of
    // a recurring schedule" flag. Manual one-offs from
    // NewSessionSheet set it to false. Historical rows (pre-
    // migration 025) have it true via the migration's backfill.
    // Reading `=== false` rather than `!== true` is intentional:
    // any row that genuinely has the flag set to false is treated
    // as a one-off; any other value (including older rows that
    // somehow lack the column) is allowed through.
    if (s.is_recurring === false) return false;
    return true;
  });
  if (scheduledRegular.length === 0) return [];

  // A (day, time) slot is part of the recurring schedule only if it
  // has MULTIPLE future scheduled sessions on it. The patient-creation
  // flow + applyScheduleChange both insert a full recurrence window
  // (~15 weeks) of sessions in one batch, so an active recurring slot
  // always has many in flight. A one-off session sits alone on its
  // slot — and historically has been mis-classified as a recurring
  // anchor when the user forgot to toggle the "tutor" type picker
  // before saving (e.g. a one-off Saturday with the parent saved as
  // `session_type='regular'`). Requiring ≥2 future sessions on the
  // slot lets one-offs remain one-offs and prevents a single mistaken
  // row from minting a weekly schedule.
  const slotCounts = new Map();
  scheduledRegular.forEach(s => {
    const k = `${s.day}|${s.time}`;
    slotCounts.set(k, (slotCounts.get(k) || 0) + 1);
  });
  const schedMap = new Map();
  scheduledRegular.forEach(s => {
    const k = `${s.day}|${s.time}`;
    if (slotCounts.get(k) < 2) return;
    if (schedMap.has(k)) return;
    schedMap.set(k, {
      day: s.day, time: s.time,
      duration: s.duration || 60,
      modality: s.modality || "presencial",
    });
  });
  if (schedMap.size === 0) return [];

  // Dedup key is (date, time) — not date alone. A patient can have two
  // sessions on the same day at different times, and a cancelled slot at
  // 10:00 must not block a new 14:00 slot on the same date. Mirrors the
  // DB unique index uniq_sessions_patient_date_time.
  const existingSlots = new Set(allPSess.map(s => `${s.date}|${s.time}`));

  let latest = null;
  scheduledRegular.forEach(s => {
    const d = parseShortDate(s.date);
    if (!latest || d > latest) latest = d;
  });
  if (!latest || latest > threshold) return [];

  // Hard floor at `today`. If the previous window expired between
  // logins or the patient took a hiatus, latest is in the past and
  // we'd otherwise back-fill the gap with phantom sessions.
  const startMs = Math.max(latest.getTime() + 86400000, today.getTime());
  const startISO = toISODate(new Date(startMs));
  // ISO comparison: an empty range (start past end) returns no dates,
  // but we guard anyway so the intent is explicit.
  if (startISO > extendEnd) return [];

  const rows = [];
  for (const sched of schedMap.values()) {
    getRecurringDates(sched.day, startISO, extendEnd).forEach(d => {
      const ds = formatShortDate(d);
      const slot = `${ds}|${sched.time}`;
      if (existingSlots.has(slot)) return;
      // Belt-and-suspenders: even though startISO is clamped to today,
      // we re-check each generated row before pushing. If anything
      // upstream regresses (timezone bug, off-by-one, etc.), we'd
      // rather drop a row than corrupt accounting.
      const rowISO = toISODate(d);
      if (rowISO < toISODate(today)) return;
      rows.push({
        user_id: userId,
        patient_id: patient.id,
        patient: patient.name,
        initials: patient.initials,
        time: sched.time, day: sched.day,
        date: ds, duration: sched.duration,
        rate: patient.rate,
        modality: sched.modality,
        // Auto-extend rows ARE recurring by definition.
        is_recurring: true,
        color_idx: patient.color_idx || 0,
      });
      existingSlots.add(slot);
    });
  }
  return rows;
}
