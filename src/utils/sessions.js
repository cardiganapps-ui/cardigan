/* ── Session display helpers used across Cardigan ── */

import { SESSION_STATUS, SESSION_TYPE, PATIENT_STATUS, DEFAULT_RECURRENCE_FREQUENCY } from "../data/constants";
import { DAY_ORDER } from "../data/seedData";
import { shortDateToISO, todayISO } from "./dates";

/* `session_type === "tutor"` is the source of truth post-migration 023.
   The startsWith("T·") fallback covers the brief deploy window before
   the migration runs, plus any legacy rows that somehow lingered with
   the old prefix. Once we're confident every row in production is
   migrated, the fallback can be retired. */
export function isTutorSession(s) {
  if (!s) return false;
  if (s.session_type === SESSION_TYPE.TUTOR) return true;
  return s.initials?.startsWith("T·") || false;
}

/* The first-contact session a therapist runs against a 'potential'
   patient (migration 047). Always created with is_recurring=false so
   it never feeds the recurring-slot derivation in computeAutoExtendRows
   — even after the patient is converted to active+recurring, the
   interview row stays one-off and keeps its original rate. */
export function isInterviewSession(s) {
  return s?.session_type === SESSION_TYPE.INTERVIEW;
}

/* Returns the initials to render in a session avatar. Post-migration
   023 the `T·` prefix is gone, so this is just `s.initials` for both
   regular and tutor sessions — but we keep the strip so any legacy
   row (or unmigrated test fixture) renders cleanly. */
export function tutorDisplayInitials(s) {
  return s.initials?.replace(/^T·/, "") || "T";
}

export function isCancelledStatus(status) {
  return status === SESSION_STATUS.CANCELLED || status === SESSION_STATUS.CHARGED;
}

export function statusClass(status) {
  if (status === SESSION_STATUS.SCHEDULED) return "status-scheduled";
  if (status === SESSION_STATUS.COMPLETED) return "status-completed";
  if (status === SESSION_STATUS.CHARGED)   return "status-charged";
  return "status-cancelled";
}

export function statusLabel(status) {
  if (status === SESSION_STATUS.CHARGED)   return "Cancelada cobrada";
  if (status === SESSION_STATUS.CANCELLED) return "Cancelada";
  if (status === SESSION_STATUS.COMPLETED) return "Completada";
  return "Agendada";
}

/** CSS class suffix for the session-row colored rail. */
export function railClass(status) {
  if (status === SESSION_STATUS.COMPLETED) return "rail-completed";
  if (status === SESSION_STATUS.CANCELLED) return "rail-cancelled";
  if (status === SESSION_STATUS.CHARGED)   return "rail-charged";
  return "rail-scheduled";
}

export function shortName(name) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function sessionDisplayLabel(s) {
  return `${s.date} · ${s.time} — ${statusLabel(s.status)}`;
}

/* ── Tutor session reminder helpers ── */

/** Find the most recent completed/charged tutor session for a patient. */
export function getLastTutorSession(sessions, patientId) {
  let best = null;
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
export function getNextTutorSession(sessions, patientId) {
  const today = todayISO();
  let best = null;
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
export function getTutorReminders(patients, sessions) {
  const today = todayISO();
  const todayMs = new Date(today + "T00:00:00").getTime();
  const DAY_MS = 86400000;
  const reminders = [];

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

/**
 * Derive a patient's active recurring schedule(s) from their non-cancelled
 * sessions. Returns `[{ day, time, duration, modality, frequency }]` sorted
 * Monday→Sunday, time ascending, deduped by `(day, time)`. Used by the
 * patient summary's "Horarios" row.
 *
 * Behavior to preserve invariants in the Resumen <-> Agenda contract:
 *   - Sessions are sorted by date ASC before dedupe so the FIRST session
 *     encountered per (day, time) slot is the EARLIEST upcoming one. This
 *     matches what the agenda renders as the next instance of that slot,
 *     so duration / modality / frequency shown in the summary always
 *     agrees with what the user sees on the next calendar tile. The
 *     previous "first by created_at" tiebreak could surface a stale older
 *     row whose fields had since been overridden — visible to users as
 *     "the agenda says 90 min but the patient summary says 60".
 *   - includePast=false (active patients) drops past-dated rows so
 *     status='scheduled' past rows (auto-displayed completed per
 *     CLAUDE.md) can't leak into the schedule snapshot.
 *   - Tutor + interview rows are ignored upstream via is_recurring=false,
 *     not here — the is_recurring filter is the contract.
 */
export function derivePatientSchedules(sessions, patientId, includePast = false) {
  if (!Array.isArray(sessions) || !patientId) return [];
  const today = todayISO();
  const filtered = [];
  for (const s of sessions) {
    if (s.patient_id !== patientId) continue;
    if (s.status === SESSION_STATUS.CANCELLED || s.status === SESSION_STATUS.CHARGED) continue;
    if (s.is_recurring !== true) continue;
    if (!includePast) {
      const iso = shortDateToISO(s.date);
      if (iso < today) continue;
    }
    filtered.push(s);
  }
  filtered.sort((a, b) => {
    const ai = shortDateToISO(a.date);
    const bi = shortDateToISO(b.date);
    if (ai !== bi) return ai < bi ? -1 : 1;
    return (a.time || "").localeCompare(b.time || "");
  });
  const seen = new Set();
  const result = [];
  for (const s of filtered) {
    const key = `${s.day}|${s.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      day: s.day,
      time: s.time,
      duration: s.duration || 60,
      modality: s.modality || "presencial",
      frequency: s.recurrence_frequency || DEFAULT_RECURRENCE_FREQUENCY,
    });
  }
  result.sort((a, b) => {
    const di = DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day);
    if (di !== 0) return di;
    return (a.time || "").localeCompare(b.time || "");
  });
  return result;
}

/**
 * Pull `{ duration, modality, frequency }` for a single patient's
 * configured (day, time) slot from their session rows. Used to seed the
 * edit-patient form so the duration/modality dropdowns reflect the
 * patient's actual current setup — not the hard-coded "60 / presencial"
 * defaults that previously rendered. Hard defaults were silently
 * destructive: a rate-only edit triggered applyScheduleChange with the
 * seed values, rewriting every future session to 60 min presencial
 * regardless of what the patient actually had configured.
 *
 * Returns the props from the EARLIEST upcoming session in that slot (same
 * tiebreak as derivePatientSchedules so seed + summary agree). Falls back
 * to any matching row, then to defaults, so episodic patients or callers
 * with empty `sessions` arrays still receive a usable shape.
 */
export function deriveSlotProps(patient, sessions) {
  const defaults = {
    duration: 60,
    modality: "presencial",
    frequency: DEFAULT_RECURRENCE_FREQUENCY,
  };
  if (!patient?.day || !patient?.time) return defaults;
  const match = (sessions || []).filter(s =>
    s.patient_id === patient.id
    && s.day === patient.day
    && s.time === patient.time
    && s.is_recurring !== false
  );
  if (match.length === 0) return defaults;
  const today = todayISO();
  const future = match
    .filter(s => shortDateToISO(s.date) >= today)
    .sort((a, b) => shortDateToISO(a.date).localeCompare(shortDateToISO(b.date)));
  const pick = future[0] || match[0];
  return {
    duration: pick.duration || 60,
    modality: pick.modality || "presencial",
    frequency: pick.recurrence_frequency || DEFAULT_RECURRENCE_FREQUENCY,
  };
}
