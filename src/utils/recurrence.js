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
import { formatShortDate, parseLocalDate, parseShortDate, toISODate } from "./dates";
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
  if (!Array.isArray(allPSess) || allPSess.length === 0) return [];

  const scheduledRegular = allPSess.filter(
    s => s.status === SESSION_STATUS.SCHEDULED && !isTutorSession(s)
  );
  if (scheduledRegular.length === 0) return [];

  const schedMap = new Map();
  scheduledRegular.forEach(s => schedMap.set(`${s.day}|${s.time}`, {
    day: s.day, time: s.time,
    duration: s.duration || 60,
    modality: s.modality || "presencial",
  }));

  const existingDates = new Set(allPSess.map(s => s.date));

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
      if (existingDates.has(ds)) return;
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
        color_idx: patient.color_idx || 0,
      });
      existingDates.add(ds);
    });
  }
  return rows;
}
