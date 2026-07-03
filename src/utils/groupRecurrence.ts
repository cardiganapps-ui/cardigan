/* ── Group-session generation helpers ──

   Pure functions used by useGroups (initial generation, member backfill,
   schedule change) and useCardiganData (group auto-extend on login). Kept
   React-free so they can be unit-tested without supabase or any UI.

   These mirror utils/recurrence.js (the per-patient equivalents) and reuse
   getRecurringDates directly. The same accounting-integrity rules apply
   (see CLAUDE.md prime directive): NEVER generate past-dated rows, and the
   resolved per-member rate is frozen onto each row.

   A group occurrence fans out into one ordinary `sessions` row per ACTIVE
   member. Every row carries a real patient_id + rate, so the accounting
   engine treats it exactly like an individual session — there is no
   group-rate concept anywhere in the money math.
*/

import { GROUP_STATUS, SCHEDULING_MODE, RECURRENCE_STRIDE_DAYS, DEFAULT_RECURRENCE_FREQUENCY, SESSION_STATUS } from "../data/constants";
import { getRecurringDates } from "./recurrence";
import { formatShortDate, parseShortDate, parseRowDate, toISODate } from "./dates";

export interface GRGroup {
  id: string;
  day?: string | null;
  time?: string | null;
  duration?: number | string | null;
  rate?: number | null;
  modality?: string | null;
  recurrence_frequency?: string | null;
  scheduling_mode?: string | null;
  status?: string | null;
  color_idx?: number | null;
}
export interface GRMember { patient_id?: string | null; left_at?: string | null }
export interface GRPatient { name?: string | null; initials?: string | null; rate?: number | null }
type PatientMap = Map<string, GRPatient> | null | undefined;
export interface GRSession { status?: string | null; time?: string | null; date: string; patient_id?: string | null; created_at?: string | null }

export interface GroupSessionRow {
  user_id: string | undefined;
  group_id: string;
  patient_id: string | null | undefined;
  patient: string;
  initials: string;
  time: string | null | undefined;
  day: string | null | undefined;
  date: string;
  duration: number;
  rate: number;
  modality: string;
  is_recurring: boolean;
  recurrence_frequency: string;
  color_idx: number;
}

interface GroupSessionRowsArgs {
  group: GRGroup | null | undefined;
  members: GRMember[] | null | undefined;
  patientsById: PatientMap;
  startISO: string;
  endISO: string;
  existingSlots?: Set<string> | string[] | null;
  userId?: string;
  onlyPatientIds?: Set<string> | null;
}
interface GroupAutoExtendArgs {
  group: GRGroup | null | undefined;
  members: GRMember[] | null | undefined;
  patientsById: PatientMap;
  groupSessions: GRSession[] | null | undefined;
  today: Date;
  threshold: Date;
  extendEnd: string;
  userId?: string;
}

/* Resolve the effective rate for a member's group session. The group has a
   FLAT rate applied to every member (product decision); when the group rate
   is unset we fall back to the member's own patient.rate so a row never
   carries a null/0 rate by accident. */
export function resolveGroupRate(group: GRGroup | null | undefined, patient: GRPatient | null | undefined): number {
  if (group?.rate != null) return group.rate;
  return patient?.rate ?? 0;
}

/* Active members only — `left_at == null`. A member who has left keeps
   their past session rows (financial history) but generates no new ones. */
function activeMembers(members: GRMember[] | null | undefined): GRMember[] {
  return (members || []).filter(m => m && m.left_at == null);
}

/* Build the session row for one (member, date) pair. patientsById maps
   patient_id → patient row (for name/initials/rate fallback). */
function buildRow({ group, member, patient, date, userId }: { group: GRGroup; member: GRMember; patient: GRPatient | null; date: Date; userId: string | undefined }): GroupSessionRow {
  const ds = formatShortDate(date);
  return {
    user_id: userId,
    group_id: group.id,
    patient_id: member.patient_id,
    patient: patient?.name || "",
    initials: patient?.initials || "",
    time: group.time,
    day: group.day,
    date: ds,
    duration: Number(group.duration) > 0 ? Number(group.duration) : 60,
    rate: resolveGroupRate(group, patient),
    modality: group.modality || "presencial",
    is_recurring: group.scheduling_mode !== SCHEDULING_MODE.EPISODIC,
    recurrence_frequency: group.recurrence_frequency || DEFAULT_RECURRENCE_FREQUENCY,
    color_idx: group.color_idx || 0,
  };
}

/**
 * Fan out a group's recurring schedule into session rows — one per
 * (active member, occurrence date) across [startISO, endISO].
 *
 * Inputs:
 *   group        — the groups row (day, time, duration, rate, modality,
 *                  recurrence_frequency, scheduling_mode, color_idx)
 *   members      — group_members rows (only active ones are used)
 *   patientsById — Map<patient_id, patient row>
 *   startISO     — ISO start (inclusive)
 *   endISO       — ISO end (inclusive)
 *   existingSlots — Set of `${patient_id}|${date}|${time}` already present
 *                   (dedup so re-runs / partial backfills don't double-insert;
 *                   the DB uniq_sessions_patient_date_time is the backstop)
 *   userId       — user_id to stamp on rows
 *   onlyPatientIds — optional Set; when present, restrict fan-out to these
 *                    members (used when backfilling a single newly-added member)
 */
export function computeGroupSessionRows({ group, members, patientsById, startISO, endISO, existingSlots, userId, onlyPatientIds }: GroupSessionRowsArgs): GroupSessionRow[] {
  if (!group || !group.day || !group.time) return [];
  const dates = getRecurringDates(group.day, startISO, endISO, group.recurrence_frequency || DEFAULT_RECURRENCE_FREQUENCY);
  if (dates.length === 0) return [];
  const seen = existingSlots instanceof Set ? existingSlots : new Set(existingSlots || []);
  const rows: GroupSessionRow[] = [];
  for (const member of activeMembers(members)) {
    if (onlyPatientIds && !onlyPatientIds.has(member.patient_id ?? "")) continue;
    const patient = patientsById?.get?.(member.patient_id ?? "") || null;
    for (const d of dates) {
      const ds = formatShortDate(d);
      const slot = `${member.patient_id}|${ds}|${group.time}`;
      if (seen.has(slot)) continue;
      rows.push(buildRow({ group, member, patient, date: d, userId }));
      seen.add(slot);
    }
  }
  return rows;
}

/**
 * Decide which group session rows to insert when auto-extending a group's
 * recurring schedule on login. Analogue of computeAutoExtendRows, but
 * SIMPLER: a group owns an explicit (day, time) template, so we read the
 * slot straight off the groups row instead of inferring it from future
 * sessions.
 *
 * Accounting invariants (CLAUDE.md prime directive) — identical to the
 * per-patient path:
 *   1. NEVER generate a past-dated row (start clamped at today, per-row
 *      re-check before push).
 *   2. Only active groups + active members extend; ended / episodic skip.
 *
 * Inputs:
 *   group         — the groups row
 *   members       — group_members rows
 *   patientsById  — Map<patient_id, patient row>
 *   groupSessions — all sessions for this group (any status, any date)
 *   today         — Date at midnight, the floor for generated dates
 *   threshold     — Date; if latest scheduled occurrence is later than this,
 *                   the schedule isn't running out yet → no extend
 *   extendEnd     — ISO date string upper bound for new occurrences
 *   userId        — user_id to stamp on rows
 */
export function computeGroupAutoExtendRows({ group, members, patientsById, groupSessions, today, threshold, extendEnd, userId }: GroupAutoExtendArgs): GroupSessionRow[] {
  if (!group || group.status !== GROUP_STATUS.ACTIVE) return [];
  if (group.scheduling_mode === SCHEDULING_MODE.EPISODIC) return [];
  if (!group.day || !group.time) return [];
  if (activeMembers(members).length === 0) return [];

  const todayISOStr = toISODate(today);

  // Latest FUTURE scheduled occurrence date for this group. Past scheduled
  // rows auto-complete in display but are never used to derive the schedule
  // (phantom-prevention — same rule as the patient path).
  let latest: Date | null = null;
  for (const s of (groupSessions || [])) {
    if (s.status !== SESSION_STATUS.SCHEDULED) continue;
    if (s.time !== group.time) continue;
    // Anchor the yearless-date parse on the row's created_at — a past
    // scheduled occurrence >6 months old would otherwise infer to a
    // FUTURE year, pass the `iso >= today` gate as a phantom future
    // slot, become `latest`, and (being > threshold) short-circuit
    // auto-extend so the group silently stops generating sessions.
    const iso = (() => { try { return toISODate(parseRowDate(s)); } catch { return null; } })();
    if (!iso || iso < todayISOStr) continue;
    const d = parseRowDate(s);
    if (!latest || d > latest) latest = d;
  }
  const DAY_MS = 86400000;
  const stride = RECURRENCE_STRIDE_DAYS[group.recurrence_frequency ?? ""] || RECURRENCE_STRIDE_DAYS[DEFAULT_RECURRENCE_FREQUENCY];
  let startMs: number;
  if (!latest) {
    // No future occurrences at all → BOOTSTRAP the full window from today.
    // Safety net for an active recurring group whose initial generation
    // failed (e.g. the stale-closure bug) or was somehow left empty: an
    // active recurring group should always have upcoming sessions.
    startMs = today.getTime();
  } else {
    // Schedule still runs comfortably past the threshold → nothing to do.
    if (latest > threshold) return [];
    startMs = Math.max(latest.getTime() + stride * DAY_MS, today.getTime());
  }
  const startISO = toISODate(new Date(startMs));
  if (startISO > extendEnd) return [];

  // Dedup against every existing row for the group's members so a hiatus or
  // a member with a one-off doesn't double-insert. Keyed (patient,date,time).
  const existingSlots = new Set((groupSessions || []).map(s => `${s.patient_id}|${s.date}|${s.time}`));

  const rows = computeGroupSessionRows({
    group, members, patientsById, startISO, endISO: extendEnd, existingSlots, userId,
  });

  // Belt-and-suspenders: drop any row that somehow resolved to a past date.
  return rows.filter(r => {
    try { return toISODate(parseShortDate(r.date)) >= todayISOStr; } catch { return false; }
  });
}
