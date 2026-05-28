/* ── Tutor-session push reminder evaluator ──
   Pure decision logic — given a snapshot of the user's tutor-eligible
   patients, their tutor sessions, and the set of (patient, kind,
   cycle_anchor) tuples we've already sent for, return the list of
   pushes to fire on this cron tick. Lives outside the cron's I/O
   so it can be unit-tested without supabase / web-push.

   See migration 075_tutor_reminders.sql for the dedupe model. */

const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const MONTH_INDEX = new Map(SHORT_MONTHS.map((m, i) => [m.toLowerCase(), i]));

/* "12-Abr" → "YYYY-MM-DD" anchored to the supplied reference year so
   the back-dated December rollover ("3-Ene" today vs "28-Dic" two
   weeks ago) doesn't land in the wrong year. We pick the closest year
   to today: the date that, parsed in either currentYear or
   currentYear-1, is nearest to today. Mirrors the same idea as
   utils/dates.js::shortDateToISO but inlined here so the cron doesn't
   reach into src/. */
export function shortDateToIsoNearTodayTz(shortDate, todayIso) {
  if (!shortDate || typeof shortDate !== "string") return null;
  const parts = shortDate.split(/[-\s]/);
  if (parts.length < 2) return null;
  const day = Number(parts[0]);
  const monthIdx = MONTH_INDEX.get(parts[1].toLowerCase());
  if (!Number.isFinite(day) || monthIdx == null) return null;
  const todayParts = todayIso.split("-");
  const todayY = Number(todayParts[0]);
  const todayMs = Date.UTC(todayY, Number(todayParts[1]) - 1, Number(todayParts[2]));
  let best = null;
  let bestGap = Infinity;
  for (const y of [todayY - 1, todayY, todayY + 1]) {
    const ms = Date.UTC(y, monthIdx, day);
    const gap = Math.abs(ms - todayMs);
    if (gap < bestGap) { bestGap = gap; best = { y, monthIdx, day }; }
  }
  if (!best) return null;
  const mm = String(best.monthIdx + 1).padStart(2, "0");
  const dd = String(best.day).padStart(2, "0");
  return `${best.y}-${mm}-${dd}`;
}

export function daysBetweenIso(aIso, bIso) {
  if (!aIso || !bIso) return 0;
  const a = Date.UTC(Number(aIso.slice(0, 4)), Number(aIso.slice(5, 7)) - 1, Number(aIso.slice(8, 10)));
  const b = Date.UTC(Number(bIso.slice(0, 4)), Number(bIso.slice(5, 7)) - 1, Number(bIso.slice(8, 10)));
  return Math.round((b - a) / 86400000);
}

/* Compute "today" as an ISO string in the given IANA timezone. Defaults
   to MX so behaviour matches the rest of the app when a tz is missing.
   Mirrors the toTimezone() helper in send-session-reminders.js — kept
   inline so the helper is import-free. */
export function tzTodayIso(tz, now = new Date()) {
  const zone = tz || "America/Mexico_City";
  let local;
  try {
    local = new Date(now.toLocaleString("en-US", { timeZone: zone }));
  } catch {
    local = new Date(now.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
  }
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const d = String(local.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* Resolve the cycle anchor for a patient: the date that grounds the
   daysUntilDue math. Priority:
     1. Most recent completed/charged tutor session date (in the user's tz)
     2. patient.start_date (already an ISO date)
     3. patient.created_at (timestamptz — take the first 10 chars; the
        ±few-hour drift across tz boundaries is irrelevant to a weeks-
        scale due-date check)
   Returns null if none of those exist (defensive — a real patient row
   always has created_at). */
export function resolveCycleAnchor(patient, tutorSessions, todayIso) {
  let bestIso = null;
  for (const s of tutorSessions) {
    if (s.patient_id !== patient.id) continue;
    if (s.status !== "completed" && s.status !== "charged") continue;
    const iso = shortDateToIsoNearTodayTz(s.date, todayIso);
    if (!iso) continue;
    if (iso > todayIso) continue; // future-dated completion is data noise; ignore
    if (!bestIso || iso > bestIso) bestIso = iso;
  }
  if (bestIso) return bestIso;
  if (patient.start_date && /^\d{4}-\d{2}-\d{2}/.test(patient.start_date)) {
    return patient.start_date.slice(0, 10);
  }
  if (patient.created_at && typeof patient.created_at === "string") {
    return patient.created_at.slice(0, 10);
  }
  return null;
}

/* Returns true if the patient already has a tutor session on the books
   for today or later — i.e. the therapist has acted on the reminder
   and we should stop nudging them. */
export function hasUpcomingTutorSession(patient, tutorSessions, todayIso) {
  for (const s of tutorSessions) {
    if (s.patient_id !== patient.id) continue;
    if (s.status !== "scheduled") continue;
    const iso = shortDateToIsoNearTodayTz(s.date, todayIso);
    if (!iso) continue;
    if (iso >= todayIso) return true;
  }
  return false;
}

/* Eligibility windows. The cron ticks every 5 min so we widen each
   window by a day either side to absorb a missed run (deploy / outage)
   without losing a reminder. Per-cycle dedupe means a wider window
   doesn't cause duplicate sends — the first tick that finds the row
   eligible writes the dedupe row and locks the rest of the window. */
const DUE_WINDOW_MIN = -1;
const DUE_WINDOW_MAX = 1;
const OVERDUE_WINDOW_MIN = -8;
const OVERDUE_WINDOW_MAX = -6;

/**
 * Given a snapshot of one user's patients, tutor sessions, and the
 * existing dedupe-row keys, return the list of `{ patient, kind,
 * cycleAnchor }` tuples that should fire as push notifications.
 *
 * Inputs:
 *   patients       — [{ id, name, parent, tutor_frequency, status,
 *                       start_date, created_at }]
 *   tutorSessions  — [{ patient_id, date, status }] where date is the
 *                    "D-MMM" short form (matches sessions.date in DB)
 *   alreadySent    — Set<string> of "${patient_id}::${kind}::${cycleAnchor}"
 *                    keys for rows already in sent_tutor_reminders
 *   todayIso       — "YYYY-MM-DD" today in the user's tz
 */
export function evaluateTutorReminders({ patients, tutorSessions, alreadySent, todayIso }) {
  const out = [];
  if (!Array.isArray(patients) || patients.length === 0) return out;
  const sessions = Array.isArray(tutorSessions) ? tutorSessions : [];
  const sent = alreadySent instanceof Set ? alreadySent : new Set(alreadySent || []);

  for (const p of patients) {
    if (!p || p.status !== "active") continue;
    if (!p.parent) continue;
    if (!p.tutor_frequency) continue;

    if (hasUpcomingTutorSession(p, sessions, todayIso)) continue;

    const anchor = resolveCycleAnchor(p, sessions, todayIso);
    if (!anchor) continue;

    const daysSince = daysBetweenIso(anchor, todayIso);
    const daysUntilDue = (p.tutor_frequency * 7) - daysSince;

    if (daysUntilDue >= DUE_WINDOW_MIN && daysUntilDue <= DUE_WINDOW_MAX) {
      const key = `${p.id}::tutor_due::${anchor}`;
      if (!sent.has(key)) out.push({ patient: p, kind: "tutor_due", cycleAnchor: anchor });
    }
    if (daysUntilDue >= OVERDUE_WINDOW_MIN && daysUntilDue <= OVERDUE_WINDOW_MAX) {
      const key = `${p.id}::tutor_overdue_7::${anchor}`;
      if (!sent.has(key)) out.push({ patient: p, kind: "tutor_overdue_7", cycleAnchor: anchor });
    }
  }
  return out;
}

/* Build the push payload for a given tutor reminder. Mirrors the
   shape used by the session-reminder branch so the front-end SW can
   handle both with the same `actions` plumbing. */
export function buildTutorPushPayload({ patient, kind }) {
  const name = patient.name || "este paciente";
  if (kind === "tutor_due") {
    return {
      title: "Sesión con tutor pendiente",
      body: `Hoy toca sesión con el tutor de ${name} y no hay nada agendado.`,
      url: `/#pacientes?patient=${patient.id}`,
      tag: `tutor-due-${patient.id}`,
      actions: [{ action: "open", title: "Agendar" }],
    };
  }
  // tutor_overdue_7
  return {
    title: "Sesión con tutor atrasada",
    body: `Han pasado 7 días sin agendar la sesión con el tutor de ${name}.`,
    url: `/#pacientes?patient=${patient.id}`,
    tag: `tutor-overdue-${patient.id}`,
    actions: [{ action: "open", title: "Agendar" }],
  };
}
