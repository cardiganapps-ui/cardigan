/* ── Session display helpers used across Cardigan ── */

import { SESSION_STATUS, PATIENT_STATUS } from "../data/constants";
import { shortDateToISO, todayISO } from "./dates";

export function isTutorSession(s) {
  return s.initials?.startsWith("T·");
}

export function tutorDisplayInitials(s) {
  return s.initials?.replace("T·", "") || "T";
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
 * the coming two weeks, or have never had a tutor session — so the user gets
 * ~1 week of early warning before the ideal cadence slips.
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

    // Show reminders up to 14 days before the ideal date — that gives
    // a full week of "heads up" before the dueSoon (≤7 days) window kicks in.
    if (daysUntilDue <= 14) {
      reminders.push({ patient: p, lastTutorSession: last, nextTutorSession: next, daysSince, daysUntilDue, frequencyWeeks: p.tutor_frequency });
    }
  }

  // Most overdue first
  reminders.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  return reminders;
}
