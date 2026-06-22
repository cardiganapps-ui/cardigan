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
import { sessionCountsTowardBalance, type BalanceSession } from "./accounting";
import { parseShortDate } from "./dates";

export interface GroupLike { id: string }
export interface GroupRow extends GroupLike { name?: string | null }
export interface GroupMember { group_id?: string | null; patient_id?: string | null; left_at?: string | null }
export interface GroupPatient { id?: string; name?: string | null; rate?: number | null }
type PatientMap = Map<string, GroupPatient> | null | undefined;
type GroupMap = Map<string, GroupRow> | null | undefined;
/** A session row that may belong to a group. */
export interface GroupSession extends BalanceSession { group_id?: string | null; duration?: number | null }

export interface HydratedMember extends GroupMember { patient: GroupPatient | null; active: boolean }
export interface GroupOccurrence {
  date: string;
  time: string | null | undefined;
  attendees: GroupSession[];
  status: string;
  count: number;
}
export interface GroupOccurrenceTile {
  _groupOccurrence: true;
  id: string;
  group_id: string;
  group: GroupRow | null;
  date: string;
  time: string | null | undefined;
  duration: number | null | undefined;
  attendees: GroupSession[];
  count: number;
  status: string;
}
export interface MemberFinance { patientId: string; name: string; consumed: number; sessions: number }

/* Hydrate a group with its roster. Returns the group plus a `members`
   array of { ...member, patient, active } sorted with active members first
   then by patient name. patientsById maps patient_id → patient row. */
export function buildGroupRoster<G extends GroupLike>(
  group: G,
  groupMembers: GroupMember[] | null | undefined,
  patientsById: PatientMap,
): G & { members: HydratedMember[] } {
  const members = (groupMembers || [])
    .filter(m => m.group_id === group.id)
    .map(m => ({
      ...m,
      patient: patientsById?.get?.(m.patient_id ?? "") || null,
      active: m.left_at == null,
    }))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return (a.patient?.name || "").localeCompare(b.patient?.name || "");
    });
  return { ...group, members };
}

/* Count of active members in a group. */
export function activeMemberCount(group: GroupLike, groupMembers: GroupMember[] | null | undefined): number {
  return (groupMembers || []).filter(m => m.group_id === group.id && m.left_at == null).length;
}

/* Derive a group's occurrence status from its attendee rows:
     - 'cancelled'  → every attendee row is cancelled
     - 'completed'  → at least one attendee took place (completed/charged/
                      past-scheduled) and none are still upcoming-scheduled
     - 'scheduled'  → otherwise (still upcoming) */
function deriveOccurrenceStatus(attendees: GroupSession[], now: Date): string {
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
export function groupOccurrences(group: GroupLike, sessions: GroupSession[] | null | undefined, now: Date = new Date()): GroupOccurrence[] {
  const byKey = new Map<string, { date: string; time: string | null | undefined; attendees: GroupSession[] }>();
  for (const s of (sessions || [])) {
    if (s.group_id !== group.id) continue;
    const key = `${s.date}|${s.time}`;
    if (!byKey.has(key)) byKey.set(key, { date: s.date, time: s.time, attendees: [] });
    byKey.get(key)!.attendees.push(s);
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

/* Collapse a (time-sorted) list of session rows so that the N member rows
   of one group occurrence become a single synthetic tile. Non-group rows
   pass through untouched and in place. The synthetic item is keyed on
   (group_id, date, time) and carries its attendee rows + a derived status,
   so Agenda/Home can render one consolidated "group tile" instead of N rows.
   Order is preserved: the tile lands at the position of the occurrence's
   first row. groupsById maps group_id → group (for name/color). */
export function collapseGroupOccurrences(sessions: GroupSession[] | null | undefined, groupsById: GroupMap, now: Date = new Date()): (GroupSession | GroupOccurrenceTile)[] {
  const out: (GroupSession | GroupOccurrenceTile)[] = [];
  const seen = new Set<string>();
  const byKey = new Map<string, GroupSession[]>();
  for (const s of (sessions || [])) {
    if (!s.group_id) continue;
    const key = `${s.group_id}|${s.date}|${s.time}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(s);
  }
  for (const s of (sessions || [])) {
    if (!s.group_id) { out.push(s); continue; }
    const key = `${s.group_id}|${s.date}|${s.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const attendees = byKey.get(key)!;
    out.push({
      _groupOccurrence: true,
      id: `grp-${key}`,
      group_id: s.group_id,
      group: groupsById?.get?.(s.group_id) || null,
      date: s.date,
      time: s.time,
      duration: s.duration,
      attendees,
      count: attendees.length,
      status: deriveOccurrenceStatus(attendees, now),
    });
  }
  return out;
}

/* Per-member finances rollup for a group. Consumed is Σ rate over the
   member's rows that count toward balance (reusing the canonical predicate,
   so it always agrees with amountDue). `paid` here is the member's share of
   payments toward group sessions — but payments are recorded per-patient and
   aren't earmarked to a group, so we report consumed only and let the UI
   reference the patient's overall balance. Returns { totalConsumed, perMember:
   [{ patientId, name, consumed, sessions }] }. */
export function groupFinancesRollup(
  group: GroupLike,
  groupMembers: GroupMember[] | null | undefined,
  sessions: GroupSession[] | null | undefined,
  patientsById: PatientMap,
  now: Date = new Date(),
): { totalConsumed: number; perMember: MemberFinance[] } {
  const memberIds = new Set<string>(
    (groupMembers || [])
      .filter(m => m.group_id === group.id)
      .map(m => m.patient_id)
      .filter((x): x is string => !!x)
  );
  const acc = new Map<string, { consumed: number; sessions: number }>();
  for (const s of (sessions || [])) {
    if (s.group_id !== group.id) continue;
    if (!s.patient_id) continue;
    if (!memberIds.has(s.patient_id)) continue;
    if (!acc.has(s.patient_id)) acc.set(s.patient_id, { consumed: 0, sessions: 0 });
    const entry = acc.get(s.patient_id)!;
    entry.sessions += 1;
    if (sessionCountsTowardBalance(s, now)) {
      const patient = patientsById?.get?.(s.patient_id) || null;
      entry.consumed += s.rate ?? patient?.rate ?? 0;
    }
  }
  let totalConsumed = 0;
  const perMember: MemberFinance[] = [];
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
