/* ── Group view helpers ──

   Pure, React-free derivations over groups + group_members + sessions,
   used by the Groups screens and the Agenda/Home consolidated tile.

   Nothing here is persisted: group financials are a DERIVED rollup over the
   members' ordinary session rows (reusing sessionCountsTowardBalance), never
   a denormalized counter. This keeps groups outside the prime-directive
   surface — there is only ever one source of truth for money (the sessions
   + payments rows).
*/

import { SESSION_STATUS } from "../data/constants";
import { sessionCountsTowardBalance } from "./accounting";
import { parseShortDate } from "./dates";

/* Hydrate a group with its roster. Returns the group plus a `members`
   array of { ...member, patient, active } sorted with active members first
   then by patient name. patientsById maps patient_id → patient row. */
export function buildGroupRoster(group, groupMembers, patientsById) {
  const members = (groupMembers || [])
    .filter(m => m.group_id === group.id)
    .map(m => ({
      ...m,
      patient: patientsById?.get?.(m.patient_id) || null,
      active: m.left_at == null,
    }))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return (a.patient?.name || "").localeCompare(b.patient?.name || "");
    });
  return { ...group, members };
}

/* Count of active members in a group. */
export function activeMemberCount(group, groupMembers) {
  return (groupMembers || []).filter(m => m.group_id === group.id && m.left_at == null).length;
}

/* Derive a group's occurrence status from its attendee rows:
     - 'cancelled'  → every attendee row is cancelled
     - 'completed'  → at least one attendee took place (completed/charged/
                      past-scheduled) and none are still upcoming-scheduled
     - 'scheduled'  → otherwise (still upcoming) */
function deriveOccurrenceStatus(attendees, now) {
  if (attendees.length === 0) return SESSION_STATUS.SCHEDULED;
  const allCancelled = attendees.every(a => a.status === SESSION_STATUS.CANCELLED);
  if (allCancelled) return SESSION_STATUS.CANCELLED;
  const anyUpcoming = attendees.some(a =>
    a.status === SESSION_STATUS.SCHEDULED && !sessionCountsTowardBalance(a, now)
  );
  return anyUpcoming ? SESSION_STATUS.SCHEDULED : SESSION_STATUS.COMPLETED;
}

/* Reduce a group's session rows into occurrences keyed by (date, time).
   Each occurrence carries its attendee session rows + a derived status.
   Sorted by date+time descending (newest first) by default. */
export function groupOccurrences(group, sessions, now = new Date()) {
  const byKey = new Map();
  for (const s of (sessions || [])) {
    if (s.group_id !== group.id) continue;
    const key = `${s.date}|${s.time}`;
    if (!byKey.has(key)) byKey.set(key, { date: s.date, time: s.time, attendees: [] });
    byKey.get(key).attendees.push(s);
  }
  const occs = [...byKey.values()].map(o => ({
    ...o,
    status: deriveOccurrenceStatus(o.attendees, now),
    count: o.attendees.length,
  }));
  occs.sort((a, b) => {
    const da = parseShortDate(a.date).getTime();
    const db = parseShortDate(b.date).getTime();
    if (da !== db) return db - da;
    return (b.time || "").localeCompare(a.time || "");
  });
  return occs;
}

/* Per-member finances rollup for a group. Consumed is Σ rate over the
   member's rows that count toward balance (reusing the canonical predicate,
   so it always agrees with amountDue). `paid` here is the member's share of
   payments toward group sessions — but payments are recorded per-patient and
   aren't earmarked to a group, so we report consumed only and let the UI
   reference the patient's overall balance. Returns { totalConsumed, perMember:
   [{ patientId, name, consumed, sessions }] }. */
export function groupFinancesRollup(group, groupMembers, sessions, patientsById, now = new Date()) {
  const memberIds = new Set(
    (groupMembers || []).filter(m => m.group_id === group.id).map(m => m.patient_id)
  );
  const acc = new Map();
  for (const s of (sessions || [])) {
    if (s.group_id !== group.id) continue;
    if (!memberIds.has(s.patient_id)) continue;
    if (!acc.has(s.patient_id)) acc.set(s.patient_id, { consumed: 0, sessions: 0 });
    const entry = acc.get(s.patient_id);
    entry.sessions += 1;
    if (sessionCountsTowardBalance(s, now)) {
      const patient = patientsById?.get?.(s.patient_id) || null;
      entry.consumed += s.rate ?? patient?.rate ?? 0;
    }
  }
  let totalConsumed = 0;
  const perMember = [];
  for (const patientId of memberIds) {
    const entry = acc.get(patientId) || { consumed: 0, sessions: 0 };
    totalConsumed += entry.consumed;
    const patient = patientsById?.get?.(patientId) || null;
    perMember.push({
      patientId,
      name: patient?.name || "",
      consumed: entry.consumed,
      sessions: entry.sessions,
    });
  }
  perMember.sort((a, b) => a.name.localeCompare(b.name));
  return { totalConsumed, perMember };
}
