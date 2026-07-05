/* ── Session display helpers used across Cardigan ── */

import { SESSION_STATUS, SESSION_TYPE, PATIENT_STATUS } from "../data/constants";
import { shortDateToISO, todayISO } from "./dates";

/** Minimal session shape these helpers read (a subset of a sessions row). */
export interface SessionLike {
  patient_id?: string | null;
  session_type?: string | null;
  initials?: string | null;
  status?: string | null;
  date?: string | null;
  time?: string | null;
}

/** Minimal patient shape for the tutor-reminder helpers. */
export interface PatientLike {
  id: string;
  status?: string | null;
  parent?: string | null;
  tutor_frequency?: number | null;
}

export interface TutorReminder {
  patient: PatientLike;
  lastTutorSession: SessionLike | null;
  nextTutorSession: SessionLike | null;
  daysSince: number | null;
  daysUntilDue: number;
  frequencyWeeks: number;
}

/* `session_type === "tutor"` is the source of truth post-migration 023.
   The startsWith("T·") fallback covers the brief deploy window before
   the migration runs, plus any legacy rows that somehow lingered with
   the old prefix. Once we're confident every row in production is
   migrated, the fallback can be retired. */
export function isTutorSession(s: SessionLike | null | undefined): boolean {
  if (!s) return false;
  if (s.session_type === SESSION_TYPE.TUTOR) return true;
  return s.initials?.startsWith("T·") || false;
}

/* The first-contact session a therapist runs against a 'potential'
   patient (migration 047). Always created with is_recurring=false so
   it never feeds the recurring-slot derivation in computeAutoExtendRows
   — even after the patient is converted to active+recurring, the
   interview row stays one-off and keeps its original rate. */
export function isInterviewSession(s: SessionLike | null | undefined): boolean {
  return s?.session_type === SESSION_TYPE.INTERVIEW;
}

/* Returns the initials to render in a session avatar. Post-migration
   023 the `T·` prefix is gone, so this is just `s.initials` for both
   regular and tutor sessions — but we keep the strip so any legacy
   row (or unmigrated test fixture) renders cleanly. */
export function tutorDisplayInitials(s: SessionLike): string {
  return s.initials?.replace(/^T·/, "") || "T";
}

export function isCancelledStatus(status: string | null | undefined): boolean {
  return status === SESSION_STATUS.CANCELLED || status === SESSION_STATUS.CHARGED;
}

export function statusClass(status: string | null | undefined): string {
  if (status === SESSION_STATUS.SCHEDULED) return "status-scheduled";
  if (status === SESSION_STATUS.COMPLETED) return "status-completed";
  if (status === SESSION_STATUS.CHARGED)   return "status-charged";
  return "status-cancelled";
}

export function statusLabel(status: string | null | undefined): string {
  if (status === SESSION_STATUS.CHARGED)   return "Cancelada cobrada";
  if (status === SESSION_STATUS.CANCELLED) return "Cancelada";
  if (status === SESSION_STATUS.COMPLETED) return "Completada";
  return "Agendada";
}

/** CSS class suffix for the session-row colored rail. */
export function railClass(status: string | null | undefined): string {
  if (status === SESSION_STATUS.COMPLETED) return "rail-completed";
  if (status === SESSION_STATUS.CANCELLED) return "rail-cancelled";
  if (status === SESSION_STATUS.CHARGED)   return "rail-charged";
  return "rail-scheduled";
}

export function shortName(name: string | null | undefined): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function sessionDisplayLabel(s: SessionLike): string {
  return `${s.date} · ${s.time} — ${statusLabel(s.status)}`;
}

/* ── Time-range overlap ──
   Whether two same-day sessions' time ranges intersect. Used by the
   scheduling sheets to WARN about overlapping bookings (16:00×60min vs
   16:30) without blocking them — overlaps are sometimes intentional
   (couples back-to-back, a tutor slot inside a family block). The
   EXACT same start time stays hard-blocked separately: the DB's
   uniq_sessions_user_slot index rejects it, so that check is a
   constraint mirror, not a preference. */
export function timeToMinutes(time: string | null | undefined): number {
  const [h, m] = String(time || "").split(":");
  // Number("") is 0, so blank input needs an explicit reject.
  if (!h?.trim()) return NaN;
  const hh = Number(h), mm = Number(m);
  if (!Number.isFinite(hh)) return NaN;
  return hh * 60 + (Number.isFinite(mm) ? mm : 0);
}

export function timesOverlap(
  timeA: string | null | undefined, durationA: number | string | null | undefined,
  timeB: string | null | undefined, durationB: number | string | null | undefined,
): boolean {
  const startA = timeToMinutes(timeA);
  const startB = timeToMinutes(timeB);
  if (Number.isNaN(startA) || Number.isNaN(startB)) return false;
  const endA = startA + (Number(durationA) > 0 ? Number(durationA) : 60);
  const endB = startB + (Number(durationB) > 0 ? Number(durationB) : 60);
  return startA < endB && startB < endA;
}

/* ── Tutor session reminder helpers ── */

/** Find the most recent completed/charged tutor session for a patient. */
export function getLastTutorSession(sessions: SessionLike[], patientId: string): SessionLike | null {
  let best: SessionLike | null = null;
  let bestISO = "";
  for (const s of sessions) {
    if (s.patient_id !== patientId) continue;
    if (!isTutorSession(s)) continue;
    if (s.status !== SESSION_STATUS.COMPLETED && s.status !== SESSION_STATUS.CHARGED) continue;
    const iso = shortDateToISO(s.date);
    if (iso > bestISO) { bestISO = iso; best = s; }
  }
  return best;
}

/** Find the soonest scheduled tutor session in the future for a patient. */
export function getNextTutorSession(sessions: SessionLike[], patientId: string): SessionLike | null {
  const today = todayISO();
  let best: SessionLike | null = null;
  let bestISO = "";
  for (const s of sessions) {
    if (s.patient_id !== patientId) continue;
    if (!isTutorSession(s)) continue;
    if (s.status !== SESSION_STATUS.SCHEDULED) continue;
    const iso = shortDateToISO(s.date);
    if (iso < today) continue;
    if (!bestISO || iso < bestISO) { bestISO = iso; best = s; }
  }
  return best;
}

/**
 * Compute tutor reminders for all eligible patients.
 * Returns an array of { patient, lastTutorSession, nextTutorSession, daysSince, daysUntilDue, frequencyWeeks }
 * sorted by most overdue first. Surfaces patients who are overdue, due within
 * the coming week, or have never had a tutor session — only shows reminders
 * 1 week before the ideal date (or already overdue).
 */
export function getTutorReminders(patients: PatientLike[], sessions: SessionLike[]): TutorReminder[] {
  const today = todayISO();
  const todayMs = new Date(today + "T00:00:00").getTime();
  const DAY_MS = 86400000;
  const reminders: TutorReminder[] = [];

  for (const p of patients) {
    if (p.status !== PATIENT_STATUS.ACTIVE) continue;
    if (!p.parent) continue;
    if (!p.tutor_frequency) continue;

    const last = getLastTutorSession(sessions, p.id);
    const next = getNextTutorSession(sessions, p.id);
    if (!last) {
      // Never had a tutor session — always show as reminder
      reminders.push({ patient: p, lastTutorSession: null, nextTutorSession: next, daysSince: null, daysUntilDue: -Infinity, frequencyWeeks: p.tutor_frequency });
      continue;
    }

    const lastISO = shortDateToISO(last.date);
    const lastMs = new Date(lastISO + "T00:00:00").getTime();
    const daysSince = Math.round((todayMs - lastMs) / DAY_MS);
    const daysUntilDue = (p.tutor_frequency * 7) - daysSince;

    // Surface reminders only within one week of the ideal date (or already
    // overdue) so the Home list doesn't nag users weeks in advance.
    if (daysUntilDue <= 7) {
      reminders.push({ patient: p, lastTutorSession: last, nextTutorSession: next, daysSince, daysUntilDue, frequencyWeeks: p.tutor_frequency });
    }
  }

  // Most overdue first
  reminders.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  return reminders;
}
