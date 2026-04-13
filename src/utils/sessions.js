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
  return "status-cancelled";
}

export function statusLabel(status) {
  if (isCancelledStatus(status)) return "Cancelada";
  if (status === SESSION_STATUS.COMPLETED) return "Completada";
  return "Agendada";
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

/**
 * Compute tutor reminders for all eligible patients.
 * Returns an array of { patient, lastTutorSession, daysSince, daysUntilDue, frequencyWeeks }
 * sorted by most overdue first. Only includes reminders that are due within
 * 7 days or already overdue, plus patients with no tutor session at all.
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
    if (!last) {
      // Never had a tutor session — always show as reminder
      reminders.push({ patient: p, lastTutorSession: null, daysSince: null, daysUntilDue: -Infinity, frequencyWeeks: p.tutor_frequency });
      continue;
    }

    const lastISO = shortDateToISO(last.date);
    const lastMs = new Date(lastISO + "T00:00:00").getTime();
    const daysSince = Math.round((todayMs - lastMs) / DAY_MS);
    const daysUntilDue = (p.tutor_frequency * 7) - daysSince;

    if (daysUntilDue <= 7) {
      reminders.push({ patient: p, lastTutorSession: last, daysSince, daysUntilDue, frequencyWeeks: p.tutor_frequency });
    }
  }

  // Most overdue first
  reminders.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  return reminders;
}
