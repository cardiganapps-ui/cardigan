import type { Dispatch, SetStateAction } from "react";
import { supabase } from "../supabaseClient";
import {
  GROUP_STATUS, SCHEDULING_MODE, SESSION_STATUS,
  RECURRENCE_WINDOW_WEEKS, DEFAULT_RECURRENCE_FREQUENCY,
} from "../data/constants";
import { parseShortDate, parseLocalDate, toISODate } from "../utils/dates";
import { sessionCountsTowardBalance } from "../utils/accounting";
import { computeGroupSessionRows } from "../utils/groupRecurrence";
import type { GRGroup, GRMember, GRPatient, GroupSessionRow } from "../utils/groupRecurrence";
import { enqueue, registerHandler } from "../lib/mutationQueue";

// ── Domain row types ────────────────────────────────────────────────
interface Patient extends GRPatient {
  id: string;
  name: string;
  sessions: number;
  billed: number;
  colorIdx?: number | null;
  color_idx?: number | null;
  [key: string]: unknown;
}

interface Group extends GRGroup {
  name?: string;
  version?: number | null;
  colorIdx?: number | null;
  [key: string]: unknown;
}

interface Session {
  id: string;
  patient_id?: string | null;
  group_id?: string | null;
  status?: string | null;
  date: string;
  time?: string | null;
  day?: string | null;
  rate?: number | null;
  duration?: number | null;
  modality?: string | null;
  cancel_reason?: string | null;
  color_idx?: number | null;
  colorIdx?: number | null;
  [key: string]: unknown;
}

interface GroupMember {
  id?: string;
  user_id?: string;
  group_id?: string | null;
  patient_id?: string | null;
  left_at?: string | null;
  _optimistic?: boolean;
  [key: string]: unknown;
}

/** A fan-out session row from groupRecurrence, optionally carrying a
    server-assigned id once persisted. */
type FanoutRow = GroupSessionRow & { id?: string };

type Maybe = string | null | undefined;

type SetPatients = Dispatch<SetStateAction<Patient[]>>;
type SetGroups = Dispatch<SetStateAction<Group[]>>;
type SetGroupMembers = Dispatch<SetStateAction<GroupMember[]>>;
type SetSessions = Dispatch<SetStateAction<Session[]>>;
type SetFlag = Dispatch<SetStateAction<boolean>>;
type SetError = Dispatch<SetStateAction<string>>;

/* ── Group (Grupos) domain actions ──

   Factory mirroring createSessionActions. A group is a recurring schedule
   template (`groups`) plus a roster (`group_members`). Group occurrences
   fan out into ordinary `sessions` rows — one per active member — so all
   accounting flows through the existing per-patient pipeline unchanged.

   All session-fan-out writes reuse the `sessions.bulk_insert` 23505-as-
   success semantics (see useSessions) so re-runs / offline replays are
   idempotent against uniq_sessions_patient_date_time.
*/

// ── Offline queue handlers (registered once at module load) ──
// Note: there is intentionally no "groups.insert" / "group_members.delete"
// offline handler. Group creation requires connectivity (the real group id
// is needed to attach members + fan out sessions, so an offline create
// can't be replayed coherently), and member removal is a soft-leave
// (group_members.update of left_at) + session deletes, never a hard
// group_members delete.
registerHandler("groups.update", async ({ id, userId, patch }: { id: string; userId: string; patch: Record<string, unknown> }) => {
  return await supabase.from("groups").update(patch).eq("id", id).eq("user_id", userId);
});

registerHandler("groups.delete", async ({ id, userId, scheduledIds }: { id: string; userId: string; scheduledIds?: string[] }) => {
  // Delete scheduled member rows first (they'd collide on uniq_sessions_user_slot
  // once SET NULL detaches them); then delete the group. Idempotent on replay.
  if (scheduledIds && scheduledIds.length > 0) {
    const r1 = await supabase.from("sessions").delete().eq("user_id", userId).in("id", scheduledIds);
    if (r1.error) return r1;
  }
  return await supabase.from("groups").delete().eq("id", id).eq("user_id", userId);
});

registerHandler("group_members.insert", async ({ rows }: { rows: Record<string, unknown>[] }) => {
  const result = await supabase.from("group_members").insert(rows).select();
  if (result.error?.code === "23505") return { data: [], error: null };
  return result;
});

registerHandler("group_members.update", async ({ id, userId, patch }: { id: string; userId: string; patch: Record<string, unknown> }) => {
  return await supabase.from("group_members").update(patch).eq("id", id).eq("user_id", userId);
});

// Fan-out bulk insert (group session generation / member backfill / extend).
// Idempotent via the 23505 swallow — a prior drain that already inserted the
// rows trips uniq_sessions_patient_date_time and we treat it as success.
registerHandler("groups.generate_sessions", async ({ rows }: { rows: Record<string, unknown>[] }) => {
  const result = await supabase.from("sessions").insert(rows).select();
  if (result.error?.code === "23505") return { data: [], error: null };
  return result;
});

// Group schedule change: delete future group rows + update group + bulk
// insert. Each step idempotent on retry (delete-by-id no-ops, group patch is
// the same value, bulk insert swallows 23505).
registerHandler("groups.apply_schedule_change", async ({ groupId, userId, toDeleteIds, groupPatch, newRows }: { groupId: string; userId: string; toDeleteIds?: string[]; groupPatch: Record<string, unknown>; newRows?: Record<string, unknown>[] }) => {
  if (toDeleteIds && toDeleteIds.length > 0) {
    const r1 = await supabase.from("sessions").delete().eq("user_id", userId).in("id", toDeleteIds);
    if (r1.error) return r1;
  }
  const r2 = await supabase.from("groups").update(groupPatch).eq("id", groupId).eq("user_id", userId);
  if (r2.error) return r2;
  if (newRows && newRows.length > 0) {
    const r3 = await supabase.from("sessions").insert(newRows).select();
    if (r3.error?.code === "23505") return { data: [], error: null };
    return r3;
  }
  return { error: null };
});

// Whole-occurrence cancel: one bulk UPDATE over all scheduled member rows
// for (group, date, time). Idempotent — re-running the same status set is a
// no-op once the rows have moved off 'scheduled'.
registerHandler("groups.cancel_occurrence", async ({ groupId, userId, date, time, status, reason }: { groupId: string; userId: string; date: string; time: string; status: string; reason?: string | null }) => {
  return await supabase.from("sessions")
    .update({ status, cancel_reason: reason ?? null })
    .eq("user_id", userId).eq("group_id", groupId)
    .eq("date", date).eq("time", time)
    .eq("status", SESSION_STATUS.SCHEDULED);
});

// Move a whole group occurrence to a new (date, time). Idempotent — a
// replay filters on the OLD slot, which after the first run matches nothing.
registerHandler("groups.reschedule_occurrence", async ({ groupId, userId, fromDate, fromTime, patch }: { groupId: string; userId: string; fromDate: string; fromTime: string; patch: Record<string, unknown> }) => {
  return await supabase.from("sessions").update(patch)
    .eq("user_id", userId).eq("group_id", groupId)
    .eq("date", fromDate).eq("time", fromTime)
    .eq("status", "scheduled");
});

// Delete a set of session rows by id (member removal offline replay).
// Idempotent — re-deleting already-gone ids is a no-op.
registerHandler("groups.delete_sessions", async ({ ids, userId }: { ids?: string[]; userId: string }) => {
  if (!ids?.length) return { error: null };
  return await supabase.from("sessions").delete().eq("user_id", userId).in("id", ids);
});

// End a group: status flip + delete future scheduled group rows. Idempotent.
registerHandler("groups.end", async ({ groupId, userId, toDeleteIds }: { groupId: string; userId: string; toDeleteIds?: string[] }) => {
  if (toDeleteIds && toDeleteIds.length > 0) {
    const r1 = await supabase.from("sessions").delete().eq("user_id", userId).in("id", toDeleteIds);
    if (r1.error) return r1;
  }
  return await supabase.from("groups").update({ status: GROUP_STATUS.ENDED }).eq("id", groupId).eq("user_id", userId);
});

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function tempId(prefix = "temp") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Spanish weekday by Date.getDay() (0=Sunday).
const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function defaultWindow(startDate?: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = startDate ? parseLocalDate(startDate) : today;
  const startISO = toISODate(start < today ? today : start);
  const endISO = toISODate(new Date(today.getTime() + RECURRENCE_WINDOW_WEEKS * 7 * 86400000));
  return { startISO, endISO };
}

export function createGroupActions(
  userId: string,
  patients: Patient[],
  setPatients: SetPatients,
  groups: Group[],
  setGroups: SetGroups,
  groupMembers: GroupMember[],
  setGroupMembers: SetGroupMembers,
  upcomingSessions: Session[],
  setUpcomingSessions: SetSessions,
  setMutating: SetFlag,
  setMutationError: SetError,
) {
  const patientsById = new Map((patients || []).map(p => [p.id, p] as [string, Patient]));

  // Apply optimistic per-patient counter deltas for a freshly-built set of
  // fan-out rows + push the rows into local session state. Mirrors the
  // counter bookkeeping in useSessions.generateRecurringSessions; the DB
  // trigger reconciles to truth on the next fetch.
  function applyFanoutOptimistic(rows: FanoutRow[], { asTemp }: { asTemp?: boolean } = {}) {
    if (rows.length === 0) return;
    const now = new Date();
    const deltas = new Map<Maybe, { sessions: number; billed: number }>(); // patient_id → { sessions, billed }
    for (const r of rows) {
      const d = deltas.get(r.patient_id) || { sessions: 0, billed: 0 };
      d.sessions += 1;
      if (sessionCountsTowardBalance(r, now)) d.billed += r.rate ?? patientsById.get(r.patient_id ?? "")?.rate ?? 0;
      deltas.set(r.patient_id, d);
    }
    const localRows = rows.map(r => ({
      ...r,
      id: asTemp ? tempId() : (r.id as string),
      status: SESSION_STATUS.SCHEDULED,
      colorIdx: r.color_idx,
      ...(asTemp ? { _optimistic: true } : {}),
    })) as Session[];
    setUpcomingSessions(prev => [...prev, ...localRows]);
    setPatients(prev => prev.map(p => {
      const d = deltas.get(p.id);
      return d ? { ...p, sessions: (p.sessions || 0) + d.sessions, billed: (p.billed || 0) + d.billed } : p;
    }));
  }

  // Build the dedup set of slots a set of patients already occupy.
  function existingSlotsFor(patientIds: Set<Maybe> | Maybe[]) {
    const ids = patientIds instanceof Set ? patientIds : new Set(patientIds);
    return new Set(
      (upcomingSessions || [])
        .filter(s => ids.has(s.patient_id))
        .map(s => `${s.patient_id}|${s.date}|${s.time}`)
    );
  }

  async function generateGroupSessions(groupId: string, { startDate, endDate, onlyPatientIds, force, group: explicitGroup, members: explicitMembers }: {
    startDate?: string;
    endDate?: string;
    onlyPatientIds?: string[];
    force?: boolean;
    group?: Group;
    members?: GRMember[];
  } = {}) {
    // CRITICAL: callers right after createGroup/addMembers pass the group +
    // members EXPLICITLY, because the just-inserted rows aren't in the
    // `groups`/`groupMembers` closure state yet (setState is async). Reading
    // them from state here would see "0 members" and generate nothing — the
    // bug that shipped a group with no sessions. Fall back to state only when
    // no override is given (e.g. a standalone re-generate).
    const group = explicitGroup || groups.find(g => g.id === groupId);
    if (!group || !group.day || !group.time) return false;
    const members = (explicitMembers || (groupMembers || []).filter(m => m.group_id === groupId))
      .filter(m => m.left_at == null);
    if (members.length === 0) return false;
    // Episodic groups don't auto-generate a recurring window — but an
    // explicit one-off generation (createGroup with force) does mint the
    // single chosen occurrence. The auto-extend pass never passes force.
    if (group.scheduling_mode === SCHEDULING_MODE.EPISODIC && !force) return false;

    const { startISO, endISO } = defaultWindow(startDate);
    const memberIds = new Set(members.map(m => m.patient_id));
    const rows = computeGroupSessionRows({
      group, members, patientsById,
      startISO, endISO: endDate || endISO,
      existingSlots: existingSlotsFor(memberIds),
      userId,
      onlyPatientIds: onlyPatientIds ? new Set(onlyPatientIds) : undefined,
    });
    if (rows.length === 0) return false;

    setMutationError("");
    if (isOffline()) {
      applyFanoutOptimistic(rows, { asTemp: true });
      await enqueue("groups.generate_sessions", { rows });
      return true;
    }

    setMutating(true);
    try {
      const { data, error } = await supabase.from("sessions").insert(rows).select();
      if (error && error.code !== "23505") { setMutating(false); setMutationError(error.message); return false; }
      applyFanoutOptimistic(
        (data || []).map(r => ({ ...r })),
        { asTemp: false }
      );
      setMutating(false);
      return true;
    } catch {
      applyFanoutOptimistic(rows, { asTemp: true });
      await enqueue("groups.generate_sessions", { rows });
      setMutating(false);
      return true;
    }
  }

  async function createGroup(payload: {
    name?: string;
    colorIdx?: number;
    day?: string | null;
    time?: string | null;
    duration?: number | string | null;
    rate?: number | string | null;
    modality?: string;
    frequency?: string;
    schedulingMode?: string;
    memberPatientIds?: string[];
    startDate?: string;
    endDate?: string;
    generate?: boolean;
  }) {
    const {
      name, colorIdx = 0, day = null, time = null, duration = 60, rate = null,
      modality = "presencial", frequency = DEFAULT_RECURRENCE_FREQUENCY,
      schedulingMode = SCHEDULING_MODE.RECURRING, memberPatientIds = [],
      startDate, endDate, generate = true,
    } = payload || {};
    if (!name || !name.trim()) return false;

    const row = {
      user_id: userId, name: name.trim(), color_idx: colorIdx,
      day, time, duration: Number(duration) > 0 ? Number(duration) : 60,
      rate: rate == null || rate === "" ? null : Number(rate),
      modality, recurrence_frequency: frequency, scheduling_mode: schedulingMode,
      status: GROUP_STATUS.ACTIVE,
    };

    setMutationError("");
    setMutating(true);
    let group;
    try {
      const { data, error } = await supabase.from("groups").insert(row).select().single();
      if (error) { setMutating(false); setMutationError(error.message); return false; }
      group = { ...data, colorIdx: data.color_idx };
    } catch {
      setMutating(false); setMutationError("No se pudo crear el grupo (sin conexión)."); return false;
    }
    setGroups(prev => [...prev, group]);

    // Members
    let memberRows: Record<string, unknown>[] = [];
    if (memberPatientIds.length > 0) {
      memberRows = memberPatientIds.map(pid => ({ user_id: userId, group_id: group.id, patient_id: pid }));
      const { data: mData, error: mErr } = await supabase.from("group_members").insert(memberRows).select();
      if (!mErr && mData) setGroupMembers(prev => [...prev, ...mData]);
    }
    setMutating(false);

    if (generate && group.day && group.time && memberPatientIds.length > 0) {
      // One-off (episodic) groups generate exactly the single chosen
      // occurrence (endDate === startDate from the sheet) via force;
      // recurring groups fan out the normal window. Pass the group + members
      // EXPLICITLY — they aren't in state yet (see generateGroupSessions).
      const oneOff = schedulingMode === SCHEDULING_MODE.EPISODIC;
      const memberList = memberPatientIds.map(pid => ({ group_id: group.id, patient_id: pid, left_at: null }));
      await generateGroupSessions(group.id, { startDate, endDate, force: oneOff, group, members: memberList });
    }
    return group.id;
  }

  async function updateGroup(id: string, patch: Record<string, unknown>) {
    const group = groups.find(g => g.id === id);
    if (!group) return false;
    const dbPatch: Record<string, unknown> = { ...patch };
    if ("colorIdx" in dbPatch) { dbPatch.color_idx = dbPatch.colorIdx; delete dbPatch.colorIdx; }
    const prevVersion = group.version ?? null;
    setMutationError("");
    // Optimistic local patch + local version bump (mirrors the server-side
    // bump_version_on_update trigger from migration 076).
    setGroups(prev => prev.map(g => g.id === id
      ? ({ ...g, ...patch, ...(("colorIdx" in patch) ? { colorIdx: patch.colorIdx } : {}), version: (g.version ?? 0) + 1 } as Group)
      : g));
    try {
      // Optimistic concurrency: gate the write on the version we read. A
      // concurrent edit from another device already bumped it, so this
      // matches 0 rows → surface a conflict instead of silently clobbering.
      // Offline replay (the catch's enqueue) is intentionally last-write-
      // wins, same tradeoff as sessions (migration 066).
      let q = supabase.from("groups").update(dbPatch).eq("id", id).eq("user_id", userId);
      if (prevVersion != null) q = q.eq("version", prevVersion);
      const { data, error } = await q.select("id");
      if (error) { setMutationError(error.message); return false; }
      if (prevVersion != null && (!data || data.length === 0)) {
        setMutationError("Este grupo se modificó en otro dispositivo. Recarga para ver los cambios.");
        return false;
      }
    } catch {
      await enqueue("groups.update", { id, userId, patch: dbPatch });
    }
    return true;
  }

  async function addMembers(groupId: string, patientIds: string[]) {
    const group = groups.find(g => g.id === groupId);
    if (!group || !patientIds?.length) return false;
    // Skip patients already active in the group.
    const activeIds = new Set(groupMembers.filter(m => m.group_id === groupId && m.left_at == null).map(m => m.patient_id));
    const toAdd = patientIds.filter(pid => !activeIds.has(pid));
    if (toAdd.length === 0) return false;
    const rows = toAdd.map(pid => ({ user_id: userId, group_id: groupId, patient_id: pid }));

    setMutationError("");
    try {
      const { data, error } = await supabase.from("group_members").insert(rows).select();
      if (error && error.code !== "23505") { setMutationError(error.message); return false; }
      if (data) setGroupMembers(prev => [...prev, ...data]);
    } catch {
      setGroupMembers(prev => [...prev, ...rows.map(r => ({ ...r, id: tempId("gm"), _optimistic: true }))]);
      await enqueue("group_members.insert", { rows });
    }
    // Backfill FUTURE occurrences for the new members only (never past).
    // Pass the new members EXPLICITLY — they aren't in groupMembers state yet.
    if (group.day && group.time && group.scheduling_mode !== SCHEDULING_MODE.EPISODIC) {
      const newMembers = toAdd.map(pid => ({ group_id: groupId, patient_id: pid, left_at: null }));
      await generateGroupSessions(groupId, { group, members: newMembers });
    }
    return true;
  }

  function addMember(groupId: string, patientId: string) { return addMembers(groupId, [patientId]); }

  async function removeMember(groupId: string, patientId: string) {
    const member = groupMembers.find(m => m.group_id === groupId && m.patient_id === patientId && m.left_at == null);
    if (!member) return false;
    const leftAt = new Date().toISOString();

    // Delete the member's FUTURE scheduled group rows (date >= today); past
    // rows are financial history and stay.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const futureRows = upcomingSessions.filter(s =>
      s.group_id === groupId && s.patient_id === patientId &&
      s.status === SESSION_STATUS.SCHEDULED && parseShortDate(s.date) >= today
    );
    const toDeleteIds = futureRows.map(s => s.id).filter(id => !(typeof id === "string" && id.startsWith("temp")));
    const deletedIds = new Set(futureRows.map(s => s.id));

    setMutationError("");
    // Optimistic local: stamp left_at, drop future rows, decrement counters.
    setGroupMembers(prev => prev.map(m => m.id === member.id ? { ...m, left_at: leftAt } : m));
    if (futureRows.length > 0) {
      const now = new Date();
      const billedDelta = futureRows.reduce((sum, s) =>
        sum + (sessionCountsTowardBalance(s, now) ? (s.rate ?? patientsById.get(patientId)?.rate ?? 0) : 0), 0);
      setUpcomingSessions(prev => prev.filter(s => !deletedIds.has(s.id)));
      setPatients(prev => prev.map(p => p.id === patientId
        ? { ...p, sessions: Math.max(0, (p.sessions || 0) - futureRows.length), billed: Math.max(0, (p.billed || 0) - billedDelta) }
        : p));
    }

    try {
      const { error } = await supabase.from("group_members").update({ left_at: leftAt }).eq("id", member.id).eq("user_id", userId);
      if (error) { setMutationError(error.message); }
      if (toDeleteIds.length > 0) {
        await supabase.from("sessions").delete().eq("user_id", userId).in("id", toDeleteIds);
      }
    } catch {
      // Offline / transport error: queue BOTH the soft-leave and the
      // future-row deletes, or the removed member's sessions resurrect
      // on the next online refresh and re-inflate their counters.
      await enqueue("group_members.update", { id: member.id, userId, patch: { left_at: leftAt } });
      if (toDeleteIds.length > 0) await enqueue("groups.delete_sessions", { ids: toDeleteIds, userId });
    }
    return true;
  }

  // Move every scheduled member row of one occurrence to a new (date, time).
  // Used by week-view drag-to-reschedule. Optimistic with revert-on-error
  // (a member already booked at the target slot trips
  // uniq_sessions_patient_date_time → 23505 → we restore the prior slot).
  async function rescheduleGroupOccurrence(groupId: string, fromDate: string, fromTime: string, toDate: string, toTime: string) {
    if (!toDate || !toTime || (fromDate === toDate && fromTime === toTime)) return false;
    const rows = upcomingSessions.filter(s =>
      s.group_id === groupId && s.date === fromDate && s.time === fromTime && s.status === SESSION_STATUS.SCHEDULED);
    if (rows.length === 0) return false;
    let newDay = rows[0].day;
    try { newDay = WEEKDAYS[parseShortDate(toDate).getDay()]; } catch { /* keep prior */ }

    const ids = new Set(rows.map(r => r.id));
    const prev = rows.map(r => ({ id: r.id, date: r.date, time: r.time, day: r.day }));
    const patch = { date: toDate, time: toTime, day: newDay };

    setMutationError("");
    setUpcomingSessions(p => p.map(s => ids.has(s.id) ? { ...s, ...patch } : s));
    try {
      const { error } = await supabase.from("sessions").update(patch)
        .eq("user_id", userId).eq("group_id", groupId)
        .eq("date", fromDate).eq("time", fromTime).eq("status", SESSION_STATUS.SCHEDULED);
      if (error) {
        setUpcomingSessions(p => p.map(s => {
          const o = prev.find(x => x.id === s.id);
          return o ? { ...s, date: o.date, time: o.time, day: o.day } : s;
        }));
        setMutationError(error.code === "23505"
          ? "No se pudo mover el grupo: alguien ya tiene una sesión en ese horario."
          : error.message);
        return false;
      }
    } catch {
      await enqueue("groups.reschedule_occurrence", { groupId, userId, fromDate, fromTime, patch });
    }
    return true;
  }

  async function cancelGroupOccurrence(groupId: string, date: string, time: string, { status = SESSION_STATUS.CANCELLED, reason = null }: { status?: string; reason?: string | null } = {}) {
    const rows = upcomingSessions.filter(s =>
      s.group_id === groupId && s.date === date && s.time === time && s.status === SESSION_STATUS.SCHEDULED);
    if (rows.length === 0) return false;

    setMutationError("");
    // Optimistic: flip statuses + adjust counters (charged starts counting,
    // cancelled removes any prior counted amount for a past-scheduled row).
    const now = new Date();
    setUpcomingSessions(prev => prev.map(s =>
      (s.group_id === groupId && s.date === date && s.time === time && s.status === SESSION_STATUS.SCHEDULED)
        ? { ...s, status, cancel_reason: reason } : s));
    const billedDeltas = new Map<Maybe, number>();
    for (const s of rows) {
      const wasCounted = sessionCountsTowardBalance(s, now);
      const nowCounted = sessionCountsTowardBalance({ ...s, status }, now);
      if (wasCounted !== nowCounted) {
        const amt = s.rate ?? patientsById.get(s.patient_id ?? "")?.rate ?? 0;
        billedDeltas.set(s.patient_id, (billedDeltas.get(s.patient_id) || 0) + (nowCounted ? amt : -amt));
      }
    }
    if (billedDeltas.size > 0) {
      setPatients(prev => prev.map(p => billedDeltas.has(p.id)
        ? { ...p, billed: Math.max(0, (p.billed || 0) + (billedDeltas.get(p.id) || 0)) } : p));
    }

    try {
      const { error } = await supabase.from("sessions")
        .update({ status, cancel_reason: reason })
        .eq("user_id", userId).eq("group_id", groupId)
        .eq("date", date).eq("time", time)
        .eq("status", SESSION_STATUS.SCHEDULED);
      if (error) { setMutationError(error.message); return false; }
    } catch {
      await enqueue("groups.cancel_occurrence", { groupId, userId, date, time, status, reason });
    }
    return true;
  }

  async function endGroup(groupId: string, finishDate?: string) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return false;
    const cutoff = finishDate ? parseLocalDate(finishDate) : (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
    const futureRows = upcomingSessions.filter(s =>
      s.group_id === groupId && s.status === SESSION_STATUS.SCHEDULED && parseShortDate(s.date) >= cutoff);
    const toDeleteIds = futureRows.map(s => s.id).filter(id => !(typeof id === "string" && id.startsWith("temp")));
    const deletedIds = new Set(futureRows.map(s => s.id));

    setMutationError("");
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, status: GROUP_STATUS.ENDED } : g));
    if (futureRows.length > 0) {
      const counts = new Map<Maybe, number>();
      futureRows.forEach(s => counts.set(s.patient_id, (counts.get(s.patient_id) || 0) + 1));
      setUpcomingSessions(prev => prev.filter(s => !deletedIds.has(s.id)));
      setPatients(prev => prev.map(p => counts.has(p.id)
        ? { ...p, sessions: Math.max(0, (p.sessions || 0) - (counts.get(p.id) || 0)) } : p));
    }
    try {
      if (toDeleteIds.length > 0) await supabase.from("sessions").delete().eq("user_id", userId).in("id", toDeleteIds);
      const { error } = await supabase.from("groups").update({ status: GROUP_STATUS.ENDED }).eq("id", groupId).eq("user_id", userId);
      if (error) { setMutationError(error.message); return false; }
    } catch {
      await enqueue("groups.end", { groupId, userId, toDeleteIds });
    }
    return true;
  }

  async function applyGroupScheduleChange(groupId: string, { day, time, duration, modality, frequency, rate, effectiveDate, endDate }: {
    day?: string;
    time?: string;
    duration?: number | string | null;
    modality?: string;
    frequency?: string;
    rate?: number | string | null;
    effectiveDate?: string;
    endDate?: string;
  } = {}) {
    const group = groups.find(g => g.id === groupId);
    if (!group || !effectiveDate) return false;
    const effDate = parseLocalDate(effectiveDate);

    const members = groupMembers.filter(m => m.group_id === groupId && m.left_at == null);
    const memberIds = new Set(members.map(m => m.patient_id));

    // Delete future scheduled group rows from the effective date.
    const toDelete = upcomingSessions.filter(s =>
      s.group_id === groupId && s.status === SESSION_STATUS.SCHEDULED && parseShortDate(s.date) >= effDate);
    const toDeleteIds = toDelete.map(s => s.id).filter(id => !(typeof id === "string" && id.startsWith("temp")));
    const deletedIds = new Set(toDelete.map(s => s.id));

    const groupPatch = {
      ...(day != null ? { day } : {}),
      ...(time != null ? { time } : {}),
      ...(duration != null ? { duration: Number(duration) > 0 ? Number(duration) : 60 } : {}),
      ...(modality != null ? { modality } : {}),
      ...(frequency != null ? { recurrence_frequency: frequency } : {}),
      ...(rate !== undefined ? { rate: rate == null || rate === "" ? null : Number(rate) } : {}),
    };
    const newGroup = { ...group, ...groupPatch };

    const { endISO } = defaultWindow(effectiveDate);
    const existingSlots = new Set(
      upcomingSessions
        .filter(s => memberIds.has(s.patient_id) && !deletedIds.has(s.id))
        .map(s => `${s.patient_id}|${s.date}|${s.time}`)
    );
    const newRows = computeGroupSessionRows({
      group: newGroup, members, patientsById,
      startISO: toISODate(effDate), endISO: endDate || endISO,
      existingSlots, userId,
    });

    setMutationError("");
    // Optimistic group + session state.
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...groupPatch } : g));
    if (toDelete.length > 0) {
      // Decrement counters for the deleted rows BEFORE re-adding the new
      // ones, symmetric with applyFanoutOptimistic — otherwise sessions is
      // inflated by the deleted count until the next server refresh
      // (the DB trigger reconciles, but local state must stay truthful).
      const now = new Date();
      const dec = new Map<Maybe, { sessions: number; billed: number }>(); // patient_id → { sessions, billed }
      for (const s of toDelete) {
        const d = dec.get(s.patient_id) || { sessions: 0, billed: 0 };
        d.sessions += 1;
        if (sessionCountsTowardBalance(s, now)) d.billed += s.rate ?? patientsById.get(s.patient_id ?? "")?.rate ?? 0;
        dec.set(s.patient_id, d);
      }
      setUpcomingSessions(prev => prev.filter(s => !deletedIds.has(s.id)));
      setPatients(prev => prev.map(p => {
        const d = dec.get(p.id);
        return d ? { ...p, sessions: Math.max(0, (p.sessions || 0) - d.sessions), billed: Math.max(0, (p.billed || 0) - d.billed) } : p;
      }));
    }
    applyFanoutOptimistic(newRows, { asTemp: true });

    if (isOffline()) {
      await enqueue("groups.apply_schedule_change", { groupId, userId, toDeleteIds, groupPatch, newRows });
      return true;
    }
    setMutating(true);
    try {
      if (toDeleteIds.length > 0) {
        const { error } = await supabase.from("sessions").delete().eq("user_id", userId).in("id", toDeleteIds);
        if (error) { setMutating(false); setMutationError(error.message); return false; }
      }
      const { error: gErr } = await supabase.from("groups").update(groupPatch).eq("id", groupId).eq("user_id", userId);
      if (gErr) { setMutating(false); setMutationError(gErr.message); return false; }
      if (newRows.length > 0) {
        const { error: sErr } = await supabase.from("sessions").insert(newRows).select();
        if (sErr && sErr.code !== "23505") { setMutating(false); setMutationError(sErr.message); return false; }
      }
      setMutating(false);
      return true;
    } catch {
      await enqueue("groups.apply_schedule_change", { groupId, userId, toDeleteIds, groupPatch, newRows });
      setMutating(false);
      return true;
    }
  }

  async function deleteGroup(groupId: string) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return false;
    setMutationError("");
    // CRITICAL: the group's SCHEDULED member rows share a (user_id, date,
    // time) slot. ON DELETE SET NULL would flip them to group_id=NULL, at
    // which point they enter uniq_sessions_user_slot's scope and COLLIDE
    // (two members on one slot) → the whole DELETE aborts. So delete the
    // scheduled rows first; completed/charged/cancelled rows (status !=
    // 'scheduled', not in that index) stay and detach via SET NULL, so real
    // financial history survives as standalone sessions.
    const scheduledRows = upcomingSessions.filter(s => s.group_id === groupId && s.status === SESSION_STATUS.SCHEDULED);
    const scheduledIds = scheduledRows.map(s => s.id).filter(id => !(typeof id === "string" && id.startsWith("temp")));
    const removedIds = new Set(scheduledRows.map(s => s.id));

    // Optimistic counter decrement for the scheduled rows being removed.
    const now = new Date();
    const dec = new Map<Maybe, { sessions: number; billed: number }>();
    for (const s of scheduledRows) {
      const d = dec.get(s.patient_id) || { sessions: 0, billed: 0 };
      d.sessions += 1;
      if (sessionCountsTowardBalance(s, now)) d.billed += s.rate ?? patientsById.get(s.patient_id ?? "")?.rate ?? 0;
      dec.set(s.patient_id, d);
    }
    setGroups(prev => prev.filter(g => g.id !== groupId));
    setGroupMembers(prev => prev.filter(m => m.group_id !== groupId));
    setUpcomingSessions(prev => prev
      .filter(s => !removedIds.has(s.id))
      .map(s => s.group_id === groupId ? { ...s, group_id: null } : s));
    if (dec.size > 0) {
      setPatients(prev => prev.map(p => {
        const d = dec.get(p.id);
        return d ? { ...p, sessions: Math.max(0, (p.sessions || 0) - d.sessions), billed: Math.max(0, (p.billed || 0) - d.billed) } : p;
      }));
    }
    try {
      if (scheduledIds.length > 0) {
        const { error: delErr } = await supabase.from("sessions").delete().eq("user_id", userId).in("id", scheduledIds);
        if (delErr) { setMutationError(delErr.message); return false; }
      }
      const { error } = await supabase.from("groups").delete().eq("id", groupId).eq("user_id", userId);
      if (error) { setMutationError(error.message); return false; }
    } catch {
      await enqueue("groups.delete", { id: groupId, userId, scheduledIds });
    }
    return true;
  }

  return {
    createGroup, updateGroup, deleteGroup, endGroup,
    addMember, addMembers, removeMember,
    generateGroupSessions, applyGroupScheduleChange, cancelGroupOccurrence,
    rescheduleGroupOccurrence,
  };
}
