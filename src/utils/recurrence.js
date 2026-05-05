/* ── Recurring-session generation helpers ──

   Pure functions used by useSessions (initial generation, schedule
   change) and useCardiganData (auto-extend on login). Kept React-free
   so they can be unit-tested without the supabase client or any UI
   surface — the auto-extend logic in particular is critical for
   accounting integrity (its bugs inflated amountDue for sessions that
   never happened) and must stay covered by tests.
*/

import {
  PATIENT_STATUS, SESSION_STATUS,
  RECURRENCE_WINDOW_WEEKS,
  RECURRENCE_FREQUENCY, RECURRENCE_STRIDE_DAYS, DEFAULT_RECURRENCE_FREQUENCY,
} from "../data/constants";
import { isTutorSession, isInterviewSession } from "./sessions";
import { formatShortDate, parseLocalDate, parseShortDate, shortDateToISO, toISODate } from "./dates";

const DAY_TO_JS = { "Lunes":1, "Martes":2, "Miércoles":3, "Jueves":4, "Viernes":5, "Sábado":6, "Domingo":0 };

/* Resolve a frequency string to its stride in days. Falls back to
   weekly for unknown / null / undefined values so legacy rows with
   no recurrence_frequency column read as weekly (matches the DB
   migration 044 default). */
function strideFor(frequency) {
  return RECURRENCE_STRIDE_DAYS[frequency] || RECURRENCE_STRIDE_DAYS[DEFAULT_RECURRENCE_FREQUENCY];
}

/**
 * Recurring date series for `dayName` from `startDateStr` (inclusive)
 * to `endDateStr` (inclusive). Stride varies by `frequency` —
 * 'weekly' (every 7 days, default), 'biweekly' (every 14), 'monthly'
 * (every 28). Both date inputs are ISO ("YYYY-MM-DD"). If `endDateStr`
 * is omitted, defaults to RECURRENCE_WINDOW_WEEKS past start.
 *
 * Note on monthly: stride=28 (4 weeks) so the day-of-week is
 * preserved. Calendar-monthly (same date each month) would shift
 * the weekday with the monthly drift, which doesn't match how a
 * therapist's "Lunes" slot actually works.
 */
export function getRecurringDates(dayName, startDateStr, endDateStr, frequency = DEFAULT_RECURRENCE_FREQUENCY) {
  const target = DAY_TO_JS[dayName];
  if (target == null) return [];
  const stride = strideFor(frequency);
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
    current.setDate(current.getDate() + stride);
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
    // Interview sessions (migration 047) are one-offs by definition
    // even after a potential is converted to an active patient. The
    // is_recurring=false guard below also catches them — but
    // explicitly skipping by session_type makes the intent obvious
    // for any future maintainer reading this filter, and makes the
    // function correct under any (defensive) regression where an
    // interview row gets is_recurring=true by mistake.
    if (isInterviewSession(s)) return false;
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
      // Read frequency from the slot's existing future sessions —
      // every session in a slot carries the same value (set at
      // create / applyScheduleChange time). When a user changes
      // frequency, applyScheduleChange replays the future window at
      // the new value, so this naturally tracks the latest decision.
      // Legacy rows missing the column read as weekly via the
      // strideFor fallback.
      frequency: s.recurrence_frequency || DEFAULT_RECURRENCE_FREQUENCY,
    });
  });
  if (schedMap.size === 0) return [];

  // Dedup key is (date, time) — not date alone. A patient can have two
  // sessions on the same day at different times, and a cancelled slot at
  // 10:00 must not block a new 14:00 slot on the same date. Mirrors the
  // DB unique index uniq_sessions_patient_date_time.
  const existingSlots = new Set(allPSess.map(s => `${s.date}|${s.time}`));

  // Per-slot latest. Each slot's cadence is preserved by anchoring
  // its extension to that slot's most recent scheduled session — not
  // a global "latest across all slots" — so a multi-slot patient
  // with mixed frequencies (e.g. Lunes weekly + Miércoles monthly)
  // extends each one correctly.
  const latestPerSlot = new Map();
  scheduledRegular.forEach(s => {
    const k = `${s.day}|${s.time}`;
    if (!schedMap.has(k)) return;
    const d = parseShortDate(s.date);
    const cur = latestPerSlot.get(k);
    if (!cur || d > cur) latestPerSlot.set(k, d);
  });

  // Threshold gate uses the soonest-running-out slot — if every
  // slot is comfortably out past the threshold, no extend.
  let earliestLast = null;
  for (const d of latestPerSlot.values()) {
    if (!earliestLast || d < earliestLast) earliestLast = d;
  }
  if (!earliestLast || earliestLast > threshold) return [];

  const DAY_MS = 86400000;
  const rows = [];
  for (const [slotKey, sched] of schedMap.entries()) {
    const slotLatest = latestPerSlot.get(slotKey);
    if (!slotLatest) continue;
    // Stride-aware step from THIS slot's latest, then floored at
    // today so a hiatus doesn't back-fill the gap with phantoms.
    // For weekly (stride=7), this matches the previous "+1 day +
    // weekday-skip" behavior (the getRecurringDates skip absorbed
    // the missing 6 days). For biweekly/monthly the stride must be
    // applied here, otherwise the first inserted row would land 7
    // days after `latest` and break the cadence.
    const stride = RECURRENCE_STRIDE_DAYS[sched.frequency] || 7;
    const startMs = Math.max(slotLatest.getTime() + stride * DAY_MS, today.getTime());
    const startISO = toISODate(new Date(startMs));
    if (startISO > extendEnd) continue;
    getRecurringDates(sched.day, startISO, extendEnd, sched.frequency).forEach(d => {
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
        // Carry the slot's frequency forward so the next auto-extend
        // round reads the same value.
        recurrence_frequency: sched.frequency,
        color_idx: patient.color_idx || 0,
      });
      existingSlots.add(slot);
    });
  }
  return rows;
}
