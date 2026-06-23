import type { Dispatch, SetStateAction } from "react";
import { supabase } from "../supabaseClient";
import type { Database } from "../types/supabase";
import type { TablesInsert, TablesUpdate } from "../types/db";
import { DAY_ORDER } from "../data/seedData";
import {
  PATIENT_STATUS,
  SESSION_STATUS,
} from "../data/constants";
import { getInitials, formatShortDate, parseShortDate, parseLocalDate } from "../utils/dates";
import { recalcPatientCounters } from "../utils/patients";
import { sessionCountsTowardBalance } from "../utils/accounting";
import { getRecurringDates } from "../utils/recurrence";
import { enqueue, registerHandler, onReplay } from "../lib/mutationQueue";
import { track } from "../lib/analytics";

// Re-export for callers that historically imported it from this module.
export { getRecurringDates };

// ── Domain row types ────────────────────────────────────────────────
// Structural shapes the session actions read/write. Local to the module
// (matching the rest of the migrated hooks); the index signature keeps
// the many DB-mirrored fields the factory passes around without listing
// every column.

/** Patient fields the session path mutates. */
interface Patient {
  id: string;
  name: string;
  initials?: string | null;
  parent?: string | null;
  colorIdx?: number | null;
  rate?: number | null;
  paid?: number;
  billed: number;
  sessions: number;
  day?: string | null;
  time?: string | null;
  status?: string;
  [key: string]: unknown;
}

/** A session row as held in client state. */
interface Session {
  id: string;
  patient_id?: string | null;
  patient?: string | null;
  initials?: string | null;
  status?: string | null;
  date: string;
  time?: string | null;
  day?: string | null;
  duration?: number | null;
  rate?: number | null;
  modality?: string | null;
  session_type?: string | null;
  visit_type?: string | null;
  cancel_reason?: string | null;
  is_recurring?: boolean;
  recurrence_frequency?: string | null;
  version?: number | null;
  color_idx?: number | null;
  colorIdx?: number | null;
  _optimistic?: boolean;
  [key: string]: unknown;
}

/** Snake-cased row inserted into `sessions` (recurring generation). */
interface SessionInsertRow {
  user_id: string;
  patient_id: string;
  patient: string;
  initials?: string | null;
  time: string;
  day: string;
  date: string;
  duration: number;
  rate?: number | null;
  modality: string;
  color_idx: number;
  is_recurring?: boolean;
  recurrence_frequency?: string;
}

/** A recurring schedule slot supplied by the UI. */
interface Schedule {
  day: string;
  time: string;
  duration?: number | string | null;
  frequency?: string;
  modality?: string;
}

type SetPatients = Dispatch<SetStateAction<Patient[]>>;
type SetSessions = Dispatch<SetStateAction<Session[]>>;
type SetFlag = Dispatch<SetStateAction<boolean>>;
type SetError = Dispatch<SetStateAction<string>>;

// Offline queue handlers (registered once at module load). Each handler
// re-runs the supabase call when the queue drains on reconnect. For
// locked updates the handler intentionally OMITS the version filter —
// offline replays are last-write-wins by design (see migration 066
// and lib/mutationQueue.js for the tradeoff).
registerHandler("sessions.insert", async ({ row }: { row: Record<string, unknown> }) => {
  return await supabase.from("sessions").insert(row as TablesInsert<"sessions">).select().single();
});

registerHandler("sessions.delete", async ({ id, userId }: { id: string; userId: string }) => {
  return await supabase.from("sessions").delete().eq("id", id).eq("user_id", userId);
});

registerHandler("sessions.update_status_atomic", async ({ id, newStatus, cancelReason, enqueuedVersion }: { id: string; newStatus: string; cancelReason: string | null; enqueuedVersion?: number | null }) => {
  // Conflict detection: if the row's version has moved past what we
  // captured at enqueue time, another writer landed first. We still
  // replay (last-write-wins by design for offline) but flag the
  // result so drain() can surface the count.
  let conflict = false;
  if (enqueuedVersion != null) {
    const { data: current } = await supabase.from("sessions").select("version").eq("id", id).maybeSingle();
    if (current && current.version > enqueuedVersion) conflict = true;
  }
  const result = await supabase.rpc("update_session_status_atomic", {
    p_session_id: id,
    p_new_status: newStatus,
    p_cancel_reason: cancelReason,
  } as Database["public"]["Functions"]["update_session_status_atomic"]["Args"]);
  if (result.error) return result;
  return { ...result, conflict };
});

// Generic session UPDATE replay — used by writeSessionWithLock when
// offline / on transport error and by rescheduleSession. No version
// filter (last-write-wins on replay); enqueuedVersion is used solely
// for conflict counting.
registerHandler("sessions.update", async ({ id, userId, patch, enqueuedVersion }: { id: string; userId: string; patch: Record<string, unknown>; enqueuedVersion?: number | null }) => {
  let conflict = false;
  if (enqueuedVersion != null) {
    const { data: current } = await supabase.from("sessions").select("version").eq("id", id).maybeSingle();
    if (current && current.version > enqueuedVersion) conflict = true;
  }
  const result = await supabase.from("sessions").update(patch as TablesUpdate<"sessions">).eq("id", id).eq("user_id", userId);
  if (result.error) return result;
  return { ...result, conflict };
});

// Bulk insert (recurring schedule generation). Replay-safe via the
// 23505 swallow: if a prior drain already inserted the rows, the
// uniq_sessions_patient_date_time index errors the whole batch with
// SQLSTATE 23505. Treat as success — the trigger already recomputed
// counters on the original drain, retrying would just no-op.
registerHandler("sessions.bulk_insert", async ({ rows }: { rows: Record<string, unknown>[] }) => {
  const result = await supabase.from("sessions").insert(rows as TablesInsert<"sessions">[]).select();
  if (result.error?.code === "23505") return { data: [], error: null };
  return result;
});

// Multi-step finalize: bulk delete + patient status flip. Both steps
// are idempotent — a retry hits "nothing to delete" + "status already
// ended", both no-ops. Safe to retry on transient failure.
registerHandler("sessions.finalize_patient", async ({ patientId, userId, toDeleteIds, statusValue }: { patientId: string; userId: string; toDeleteIds?: string[]; statusValue: string }) => {
  if (toDeleteIds && toDeleteIds.length > 0) {
    const r1 = await supabase.from("sessions").delete().eq("user_id", userId).in("id", toDeleteIds);
    if (r1.error) return r1;
  }
  const r2 = await supabase.from("patients").update({ status: statusValue }).eq("id", patientId).eq("user_id", userId);
  return r2;
});

// Schedule change: bulk delete + patient patch + bulk insert, all in
// one queue entry so they replay atomically. Each step is idempotent
// on retry — the delete by id is a no-op if already done, the patient
// patch is the same value each time, and the bulk insert's 23505
// swallow makes a re-insert pass-through.
registerHandler("sessions.apply_schedule_change", async ({ patientId, userId, toDeleteIds, patientPatch, newRows }: { patientId: string; userId: string; toDeleteIds?: string[]; patientPatch: Record<string, unknown>; newRows?: Record<string, unknown>[] }) => {
  if (toDeleteIds && toDeleteIds.length > 0) {
    const r1 = await supabase.from("sessions").delete().eq("user_id", userId).in("id", toDeleteIds);
    if (r1.error) return r1;
  }
  const r2 = await supabase.from("patients").update(patientPatch as TablesUpdate<"patients">).eq("id", patientId).eq("user_id", userId);
  if (r2.error) return r2;
  if (newRows && newRows.length > 0) {
    const r3 = await supabase.from("sessions").insert(newRows as TablesInsert<"sessions">[]).select();
    if (r3.error?.code === "23505") return { data: [], error: null };
    return r3;
  }
  return { error: null };
});

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// Module-level ref to the latest setUpcomingSessions, mirrored from the
// action factory. Same pattern as usePayments — the factory runs every
// render; the onReplay subscription must register only once.
let _setUpcomingSessionsRef: SetSessions | null = null;
onReplay((entry: { op: string; optimisticMeta?: { tempId?: string } }, result: { error?: unknown; data?: Record<string, unknown> } | null) => {
  if (entry.op !== "sessions.insert") return;
  if (!result || result.error || !result.data) return;
  const tempId = entry.optimisticMeta?.tempId;
  if (!tempId || !_setUpcomingSessionsRef) return;
  const data = result.data;
  _setUpcomingSessionsRef(prev => prev.map(s => s.id === tempId
    ? ({ ...data, colorIdx: data.color_idx, modality: data.modality || "presencial" } as Session)
    : s));
});

// Spanish copy for the "another tab/device wrote first" toast. Reused
// across every session-mutation path that runs the optimistic-locking
// guard from migration 065. Keep this string here so the message stays
// uniform — users see the same wording whether they conflict on status,
// reschedule, modality, rate, visit type, or cancel reason.
const CONFLICT_MSG = "Esta sesión se editó en otro lugar. Volvimos a cargarla — intenta de nuevo.";
const MISSING_MSG = "Esta sesión ya no existe.";

export function createSessionActions(
  userId: string,
  patients: Patient[],
  setPatients: SetPatients,
  upcomingSessions: Session[],
  setUpcomingSessions: SetSessions,
  setMutating: SetFlag,
  setMutationError: SetError,
) {
  // Refresh the module-level ref so the once-registered onReplay
  // listener writes into the live state holder.
  _setUpcomingSessionsRef = setUpcomingSessions;


  // Optimistic locking conflict handler — shared by every session-update
  // path. Called when a .eq("version", v) filter rejected the write (0
  // rows updated) or when the status RPC raises SQLSTATE 40001. Decides
  // between "row was edited elsewhere" (refetch + replace local state)
  // and "row no longer exists" (drop locally) by re-reading by id. Also
  // restores the prior patient row when the optimistic mutation touched
  // patient.billed.
  async function reconcileSessionConflict(sessionId: string, prevSession: Session, prevPatient: Patient | null) {
    const { data: fresh } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (fresh) {
      setUpcomingSessions(prev => prev.map(s => s.id === sessionId
        ? { ...fresh, colorIdx: fresh.color_idx, modality: fresh.modality || "presencial" }
        : s));
      setMutationError(CONFLICT_MSG);
    } else {
      setUpcomingSessions(prev => prev.filter(s => s.id !== sessionId));
      setMutationError(MISSING_MSG);
    }
    if (prevPatient) {
      // Patient row may have been mutated by the same path; restore the
      // pre-attempt snapshot and let recalcPatientCounters reconcile from
      // truth. The recalc is fire-and-forget because the conflict UX is
      // the primary feedback.
      setPatients(prev => prev.map(p => p.id === prevPatient.id ? prevPatient : p));
      recalcPatientCounters(prevPatient.id).then((fixed) => {
        if (fixed) setPatients(prev => prev.map(p => p.id === prevPatient.id ? { ...p, ...fixed } : p));
      }).catch(() => {});
    }
  }

  async function createSession({ patientName, date, time, duration, isTutor, tutorName, customRate, modality, visitType }: {
    patientName: string;
    date: string;
    time: string;
    duration?: number | string | null;
    isTutor?: boolean;
    tutorName?: string | null;
    customRate?: number | string | null;
    modality?: string;
    visitType?: string | null;
  }) {
    if (!patientName?.trim() || !date?.trim() || !time?.trim()) return false;
    const patient = patients.find(p => p.name === patientName);
    if (!patient) return false;

    const dateObj = parseShortDate(date);
    const dayName = DAY_ORDER[(dateObj.getDay() + 6) % 7];

    // Auto-detect visit type: a patient's very first non-tutor,
    // non-interview session is the intake; everything else defaults
    // to 'followup'. The caller can override via the explicit
    // `visitType` param (e.g. when editing or when the practitioner
    // picks 'maintenance' for a post-goal patient).
    //   • Tutor sessions stay null — the taxonomy is about the
    //     patient's clinical journey, not the parent's operational
    //     visits.
    //   • Interview sessions (potential → active conversion) are
    //     pre-conversion records and don't count as "prior regular"
    //     for the post-conversion intake, so a converted patient's
    //     first scheduled regular session correctly tags as 'intake'.
    const sessionVisitType = (() => {
      if (visitType) return visitType;
      if (isTutor) return null;
      const hasPriorRegular = (upcomingSessions || []).some(
        (s) => s.patient_id === patient.id
          && s.session_type !== "tutor"
          && s.session_type !== "interview",
      );
      return hasPriorRegular ? "followup" : "intake";
    })();

    // Tutor sessions render with the parent's initials; the
    // `session_type` column (DB) and the avatar color (UI) carry the
    // tutor-vs-regular distinction. We no longer prefix initials with
    // "T·" — that legacy marker was promoted to a real column in
    // migration 023.
    const sessionInitials = isTutor
      ? getInitials(tutorName || patient.parent || "Tutor")
      : (patient.initials || getInitials(patientName));
    // Accept any finite customRate >= 0 (pro-bono / sliding-scale sessions
    // legitimately use 0). Only fall back to patient.rate when the caller
    // didn't provide a rate or passed a non-numeric value. The final
    // `?? 0` defends against a malformed patient row with null rate —
    // without it, sessionRate becomes undefined and billed becomes NaN.
    const parsedCustomRate = customRate == null || customRate === "" ? NaN : Number(customRate);
    const sessionRate = Number.isFinite(parsedCustomRate) && parsedCustomRate >= 0
      ? parsedCustomRate
      : (patient.rate ?? 0);
    const sessionDuration = Number(duration) > 0 ? Number(duration) : 60;

    setMutationError("");
    const row: TablesInsert<"sessions"> = {
      user_id: userId, patient_id: patient.id,
      patient: patientName.trim(), initials: sessionInitials,
      time: time.trim(), day: dayName, date: date.trim(),
      duration: sessionDuration, rate: sessionRate,
      modality: modality || "presencial",
      session_type: isTutor ? "tutor" : "regular",
      visit_type: sessionVisitType,
      // Manual one-off session — must NEVER seed an auto-extend
      // recurrence. Per user direction: any session added via this
      // path (NewSessionSheet's "agendar sesión") is a one-off,
      // even if its (day, time) happens to match the patient's
      // recurring slot. The DB column default would also produce
      // false, but we set it explicitly so future code reading this
      // call site immediately sees the intent.
      is_recurring: false,
      color_idx: patient.colorIdx || 0,
    };

    // Optimistic path that supports the offline queue. When offline,
    // we add a temp-id row to local state, enqueue the insert, and
    // return immediately. The replay listener swaps temp id → real id
    // on drain. patient.sessions / patient.billed run through the
    // canonical predicate locally; the trigger will recompute the
    // persisted value when the insert finally lands.
    const newSessions = patient.sessions + 1;
    const willCountNew = sessionCountsTowardBalance(
      { status: SESSION_STATUS.SCHEDULED, date: date.trim(), time: time.trim() },
    );
    const newBilled = willCountNew ? patient.billed + sessionRate : patient.billed;
    // Activation funnel: scheduling the FIRST session is the milestone
    // between "added a patient" and "money flowing". `upcomingSessions` is
    // the pre-insert closure array, so length 0 means this is the user's
    // first. Fired on each genuine-creation return path below (no PII).
    const isFirstSession = upcomingSessions.length === 0;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimisticRow = {
        ...row, id: tempId, status: SESSION_STATUS.SCHEDULED,
        colorIdx: row.color_idx, _optimistic: true,
      };
      setUpcomingSessions(prev => [...prev, optimisticRow]);
      setPatients(prev => prev.map(p => p.id === patient.id
        ? { ...p, sessions: newSessions, billed: newBilled } : p));
      await enqueue("sessions.insert", { row }, { tempId });
      if (isFirstSession) track("first_session_created");
      return true;
    }

    setMutating(true);
    let data, error;
    try {
      const res = await supabase.from("sessions").insert(row).select().single();
      data = res.data; error = res.error;
    } catch {
      // Transport-level failure mid-flight — queue with a temp row
      // so the user's optimistic insert isn't lost.
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimisticRow = {
        ...row, id: tempId, status: SESSION_STATUS.SCHEDULED,
        colorIdx: row.color_idx, _optimistic: true,
      };
      setUpcomingSessions(prev => [...prev, optimisticRow]);
      setPatients(prev => prev.map(p => p.id === patient.id
        ? { ...p, sessions: newSessions, billed: newBilled } : p));
      await enqueue("sessions.insert", { row }, { tempId });
      setMutating(false);
      if (isFirstSession) track("first_session_created");
      return true;
    }
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    // patient.sessions and patient.billed are maintained server-side
    // by trg_sessions_recalc_counters (migration 069). Local React
    // state mirrors the same predicate-gated bump the SQL function
    // applies. newSessions / newBilled were computed above for the
    // offline path; same values land here.
    setUpcomingSessions(prev => [...prev, ({ ...data!, colorIdx: data!.color_idx, modality: data!.modality || "presencial" } as Session)]);
    setPatients(prev => prev.map(p => p.id === patient.id
      ? { ...p, sessions: newSessions, billed: newBilled } : p));
    setMutating(false);
    if (isFirstSession) track("first_session_created");
    return true;
  }

  // Optimistic: local state flips immediately and the function returns
  // truthy in the next microtask — the cancel/reschedule sheet can
  // dismiss in the same visual frame. Network fires in the background;
  // on error we revert both session status and patient.billed and
  // raise the mutationError (surfaces as the app-level error toast).
  //
  // Network write goes through update_session_status_atomic (migration
  // 064) which updates the session row AND the patient.billed delta in
  // ONE transaction. Before the RPC, we did two sequential writes with
  // a recalcPatientCounters fallback if the patient write failed after
  // the session write succeeded — functionally correct but two round-
  // trips and a fork the prime directive shouldn't need. Now both
  // writes commit-or-rollback together; no fallback path required.
  //
  // The billed-delta computation stays in JS (canonical predicate from
  // utils/accounting.js::sessionCountsTowardBalance) so the predicate
  // lives in exactly one place — the RPC just applies whatever delta
  // the client computes. CLAUDE.md rule #4 still holds: counter math
  // routes through the predicate, end to end.
  async function updateSessionStatus(sessionId: string, status: string, charge?: boolean, cancelReason?: string | null) {
    const session = upcomingSessions.find(s => s.id === sessionId);
    if (!session) return false;
    const newStatus = (status === SESSION_STATUS.CANCELLED && charge) ? SESSION_STATUS.CHARGED : status;
    // RPC normalizes cancel_reason server-side when status is SCHEDULED
    // or COMPLETED — the input from the caller is preserved otherwise.
    const cancelReasonInput = cancelReason === undefined ? (session.cancel_reason ?? null) : (cancelReason || null);

    const prevSession = { ...session };
    const patient = session.patient_id ? patients.find(p => p.id === session.patient_id) : null;
    const prevPatient = patient ? { ...patient } : null;

    // Predicate-aligned optimistic billed update. The DB-side trigger
    // (trg_sessions_recalc_counters, migration 069) computes the
    // persisted patient.billed; this JS arithmetic only feeds the
    // optimistic React state so the UI doesn't lag the round-trip.
    // Shared `now` between before/after probes so a session on the
    // auto-complete boundary doesn't flip mid-decision.
    const now = new Date();
    const wasCounted = sessionCountsTowardBalance(session, now);
    const nextShape = { ...session, status: newStatus };
    const willCount = sessionCountsTowardBalance(nextShape, now);
    let targetBilled = null;
    if (patient && wasCounted !== willCount) {
      const sessRate = session.rate ?? patient.rate ?? 0;
      targetBilled = Math.max(0, patient.billed + (willCount ? sessRate : -sessRate));
    }

    // Apply optimistic state — matches the server's normalization
    // (cancel_reason cleared for SCHEDULED/COMPLETED transitions).
    const optimisticPatch = {
      status: newStatus,
      cancel_reason: (newStatus === SESSION_STATUS.SCHEDULED || newStatus === SESSION_STATUS.COMPLETED)
        ? null
        : cancelReasonInput,
    };
    setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? { ...s, ...optimisticPatch } : s));
    if (patient && targetBilled != null) {
      setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, billed: targetBilled } : p));
    }
    setMutationError("");

    // Single RPC writes the session row; patient.billed is recomputed
    // by the trigger that fires on the UPDATE. The RPC signature
    // shrank to 4 args after migration 069 — billed delta no longer
    // passed.
    //
    // p_expected_version carries the version we last read. The RPC
    // raises SQLSTATE 40001 ("serialization failure") when another tab
    // / device / patient-portal write bumped the version under our
    // feet. We surface that case via reconcileSessionConflict — refetch
    // the row, replace local state with server truth, restore the
    // patient counter via recalc. Distinct from a plain error: a 40001
    // means "your read was stale", not "the write failed".
    //
    // Offline: skip the RPC entirely, enqueue a version-less replay
    // (last-write-wins on reconnect) — the optimistic state already
    // mirrors what the user would see post-trigger.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await enqueue("sessions.update_status_atomic", {
        id: sessionId, newStatus, cancelReason: cancelReasonInput,
        enqueuedVersion: prevSession.version ?? null,
      });
      return true;
    }

    (async () => {
      try {
        const { error } = await supabase.rpc("update_session_status_atomic", {
          p_session_id: sessionId,
          p_new_status: newStatus,
          p_cancel_reason: cancelReasonInput,
          p_expected_version: prevSession.version ?? null,
        } as Database["public"]["Functions"]["update_session_status_atomic"]["Args"]);
        if (error) {
          setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? prevSession : s));
          if (error.code === "40001") {
            await reconcileSessionConflict(sessionId, prevSession, prevPatient);
          } else {
            if (prevPatient) setPatients(prev => prev.map(p => p.id === prevPatient.id ? prevPatient : p));
            setMutationError(error.message);
          }
        } else {
          // On success the trigger bumped server-side version by 1. Mirror
          // it locally so a follow-up edit on the same row passes its
          // own version check.
          setUpcomingSessions(prev => prev.map(s => s.id === sessionId
            ? { ...s, version: (prevSession.version ?? 0) + 1 }
            : s));
        }
      } catch (e) {
        setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? prevSession : s));
        if (prevPatient) setPatients(prev => prev.map(p => p.id === prevPatient.id ? prevPatient : p));
        setMutationError((e as Error)?.message || "Network error");
      }
    })();

    return true;
  }

  async function deleteSession(sessionId: string) {
    const session = upcomingSessions.find(s => s.id === sessionId);
    setMutationError("");

    // Optimistic removal. Apply BEFORE the network branch so the UI
    // updates whether we hit the wire or queue.
    setUpcomingSessions(prev => prev.filter(s => s.id !== sessionId));

    // patient.sessions and patient.billed are recomputed by the trigger
    // (migration 069) on the DELETE. Local React state mirrors the
    // predicate-aware decrement so the UI doesn't lag.
    if (session?.patient_id) {
      const patient = patients.find(p => p.id === session.patient_id);
      if (patient) {
        const sessRate = session.rate ?? patient.rate ?? 0;
        const wasBilled = sessionCountsTowardBalance(session);
        const newSessions = Math.max(0, patient.sessions - 1);
        const newBilled = wasBilled
          ? Math.max(0, patient.billed - sessRate)
          : patient.billed;
        setPatients(prev => prev.map(p => p.id === patient.id
          ? { ...p, sessions: newSessions, billed: newBilled } : p));
      }
    }

    // Skip the wire when offline, or when this is a temp-id row that
    // hasn't drained yet (no real DB row to delete).
    const isOptimisticRow = typeof sessionId === "string" && sessionId.startsWith("temp-");
    if (isOptimisticRow || (typeof navigator !== "undefined" && navigator.onLine === false)) {
      if (!isOptimisticRow) await enqueue("sessions.delete", { id: sessionId, userId });
      return true;
    }

    setMutating(true);
    let error;
    try {
      const res = await supabase.from("sessions").delete().eq("id", sessionId).eq("user_id", userId);
      error = res.error;
    } catch {
      await enqueue("sessions.delete", { id: sessionId, userId });
      setMutating(false);
      return true;
    }
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    return true;
  }

  // Undo-aware delete. Splits deleteSession's optimistic block from
  // its network commit so the App-level orchestration can show a
  // "Sesión eliminada · Deshacer" toast for ~5s and only fire the
  // supabase call (or queue, if offline) when the timer expires or
  // the tab is hidden. Returns { commit, undo }:
  //   • commit() — runs the server-side delete (or enqueues offline).
  //               No-op if undo() ran first.
  //   • undo()   — restores the snapshotted session row AND the
  //               patient counter snapshot. No-op if commit() ran.
  // The pair is shaped so the caller can wire it into setTimeout +
  // visibilitychange + toast without leaking the action's internals.
  function softDeleteSession(sessionId: string) {
    const session = upcomingSessions.find(s => s.id === sessionId);
    if (!session) return { commit: async () => true, undo: () => {} };
    const prevSession = { ...session };
    const patient = session.patient_id ? patients.find(p => p.id === session.patient_id) : null;
    const prevPatient = patient ? { ...patient } : null;

    setMutationError("");
    setUpcomingSessions(prev => prev.filter(s => s.id !== sessionId));
    if (patient) {
      const sessRate = session.rate ?? patient.rate ?? 0;
      const wasBilled = sessionCountsTowardBalance(session);
      const newSessions = Math.max(0, patient.sessions - 1);
      const newBilled = wasBilled
        ? Math.max(0, patient.billed - sessRate)
        : patient.billed;
      setPatients(prev => prev.map(p => p.id === patient.id
        ? { ...p, sessions: newSessions, billed: newBilled } : p));
    }

    let done = false;
    return {
      async commit() {
        if (done) return true;
        done = true;
        const isOptimisticRow = typeof sessionId === "string" && sessionId.startsWith("temp-");
        if (isOptimisticRow) return true;
        if (isOffline()) {
          await enqueue("sessions.delete", { id: sessionId, userId });
          return true;
        }
        try {
          const { error } = await supabase.from("sessions").delete().eq("id", sessionId).eq("user_id", userId);
          if (error) {
            // Restore on hard error so the user isn't left with a
            // missing session and no signal.
            setUpcomingSessions(prev => [prevSession, ...prev]);
            if (prevPatient) setPatients(prev => prev.map(p => p.id === prevPatient.id ? prevPatient : p));
            setMutationError(error.message);
            return false;
          }
        } catch {
          await enqueue("sessions.delete", { id: sessionId, userId });
        }
        return true;
      },
      undo() {
        if (done) return;
        done = true;
        setUpcomingSessions(prev => [prevSession, ...prev]);
        if (prevPatient) setPatients(prev => prev.map(p => p.id === prevPatient.id ? prevPatient : p));
      },
    };
  }

  // Optimistic: updates local state immediately so the SessionSheet
  // can dismiss without waiting on the network round-trip. Reverts
  // the session row on server error and surfaces it via mutationError.
  //
  // Adjusts patient.billed when the predicate's verdict flips across
  // the reschedule. Common cases:
  //   • past-completed → future-scheduled : was counted, now not → -rate
  //   • past-scheduled (auto-complete) → future-scheduled : same → -rate
  //   • future-scheduled → past-scheduled (backdate) : was not, now is → +rate
  // Without this, moving a session across the past/future boundary
  // leaves patient.billed stranded above or below consumed until the
  // next recalc.
  async function rescheduleSession(sessionId: string, newDate: string, newTime: string, newDuration?: number | string | null) {
    if (!newDate?.trim() || !newTime?.trim()) return false;
    const prevSession = upcomingSessions.find(s => s.id === sessionId);
    if (!prevSession) return false;

    const dateObj = parseShortDate(newDate);
    const dayName = DAY_ORDER[(dateObj.getDay() + 6) % 7];
    const patch: Partial<Session> = { date: newDate.trim(), time: newTime.trim(), day: dayName, status: SESSION_STATUS.SCHEDULED };
    if (newDuration != null && Number(newDuration) > 0) patch.duration = Number(newDuration);

    // Compute the predicate-aware billed delta BEFORE touching state so
    // both optimistic + revert paths agree on the same target.
    const patient = prevSession.patient_id ? patients.find(p => p.id === prevSession.patient_id) : null;
    const prevPatient = patient ? { ...patient } : null;
    const now = new Date();
    const wasCounted = sessionCountsTowardBalance(prevSession, now);
    const nextShape = { ...prevSession, ...patch };
    const willCount = sessionCountsTowardBalance(nextShape, now);
    let targetBilled = null;
    if (patient && wasCounted !== willCount) {
      const sessRate = prevSession.rate ?? patient.rate ?? 0;
      targetBilled = willCount
        ? patient.billed + sessRate
        : Math.max(0, patient.billed - sessRate);
    }

    setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? { ...s, ...patch } : s));
    if (patient && targetBilled != null) {
      setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, billed: targetBilled } : p));
    }
    setMutationError("");

    // Offline / temp-id: skip the wire, enqueue (or defer in the case
    // of a not-yet-drained insert). Optimistic state already applied.
    const isOptimisticRow = typeof sessionId === "string" && sessionId.startsWith("temp-");
    if (isOptimisticRow) return true;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await enqueue("sessions.update", { id: sessionId, userId, patch, enqueuedVersion: prevSession.version ?? null });
      return true;
    }

    (async () => {
      try {
        // Optimistic lock: .eq("version", v) → 0 rows updated when
        // another writer bumped version. .select("id") makes the
        // returned data array reflect actual rows updated; a length-0
        // result means the version filter rejected us.
        const expectedVersion = prevSession.version ?? null;
        let q = supabase.from("sessions").update(patch as TablesUpdate<"sessions">).eq("id", sessionId).eq("user_id", userId);
        if (expectedVersion != null) q = q.eq("version", expectedVersion);
        const { data, error } = await q.select("id");
        if (error) {
          setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? prevSession : s));
          if (prevPatient) setPatients(prev => prev.map(p => p.id === prevPatient.id ? prevPatient : p));
          setMutationError(error.message);
          return;
        }
        if (expectedVersion != null && (!data || data.length === 0)) {
          await reconcileSessionConflict(sessionId, prevSession, prevPatient);
          return;
        }
        // Mirror the server-side version bump locally. patient.billed
        // recompute is handled by the trigger that fired on the session
        // UPDATE — no follow-up patients write needed.
        setUpcomingSessions(prev => prev.map(s => s.id === sessionId
          ? { ...s, version: (prevSession.version ?? 0) + 1 }
          : s));
      } catch {
        // Transport-level failure — queue with last-write-wins replay.
        // Optimistic state stays so the user's reschedule is preserved.
        await enqueue("sessions.update", { id: sessionId, userId, patch, enqueuedVersion: prevSession.version ?? null });
      }
    })();

    return true;
  }

  async function generateRecurringSessions(patientId: string, schedules: Schedule[], startDate: string, endDate?: string) {
    const patient = patients.find(p => p.id === patientId);
    if (!patient || !schedules?.length || !startDate) return false;

    // Skip slots this patient already has — prevents dupes when a user
    // runs "generar sesiones" on a patient that already has some. Dedup
    // by (date, time) to mirror uniq_sessions_patient_date_time.
    const existingSlots = new Set(
      upcomingSessions
        .filter(s => s.patient_id === patientId)
        .map(s => `${s.date}|${s.time}`)
    );
    const allRows: SessionInsertRow[] = [];
    for (const s of schedules) {
      const dur = Number(s.duration) > 0 ? Number(s.duration) : 60;
      const freq = s.frequency || "weekly";
      getRecurringDates(s.day, startDate, endDate, freq).forEach(d => {
        const ds = formatShortDate(d);
        const slot = `${ds}|${s.time}`;
        if (existingSlots.has(slot)) return;
        allRows.push({ user_id: userId, patient_id: patient.id, patient: patient.name,
          initials: patient.initials, time: s.time, day: s.day,
          date: ds, duration: dur, rate: patient.rate,
          modality: s.modality || "presencial",
          color_idx: patient.colorIdx || 0,
          // These rows ARE the recurring schedule. Without is_recurring=true
          // the schedule-derivation in ResumenTab + the auto-extend loop
          // both ignore them, so a "Cambiar a recurrentes" flow that
          // calls this function would silently produce no recurring slot.
          // The prime-directive accounting tests rely on this signal as
          // well — see CLAUDE.md rule #8.
          is_recurring: true,
          recurrence_frequency: freq });
        existingSlots.add(slot);
      });
    }
    if (allRows.length === 0) return false;

    setMutationError("");

    // Optimistic counters + local rows. When offline, temp ids stand
    // in for the server-assigned ones; when online the supabase return
    // values replace them. Either way the predicate-aware delta keeps
    // UI in sync with what the trigger will compute server-side.
    const now = new Date();
    const newSessions = patient.sessions + allRows.length;
    const countedDelta = allRows.reduce((sum, r) => (
      sum + (sessionCountsTowardBalance(r, now) ? (r.rate ?? patient.rate ?? 0) : 0)
    ), 0);
    const newBilled = patient.billed + countedDelta;

    if (isOffline()) {
      // Add optimistic temp rows so the UI shows the new schedule
      // immediately. Bulk inserts use a single queue entry so the
      // bulk is replayed atomically (preserves the ordering the
      // uniq_sessions_patient_date_time index expects).
      const optimisticRows = allRows.map((r) => ({
        ...r,
        id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: SESSION_STATUS.SCHEDULED,
        colorIdx: r.color_idx,
        _optimistic: true,
      }));
      setUpcomingSessions(prev => [...prev, ...optimisticRows]);
      setPatients(prev => prev.map(p => p.id === patientId
        ? { ...p, sessions: newSessions, billed: newBilled } : p));
      await enqueue("sessions.bulk_insert", { rows: allRows });
      return true;
    }

    setMutating(true);
    let data, error;
    try {
      const res = await supabase.from("sessions").insert(allRows as TablesInsert<"sessions">[]).select();
      data = res.data; error = res.error;
    } catch {
      // Transport-level — same shape as the offline path: optimistic
      // temp rows + queue. The bulk replays atomically on drain.
      const optimisticRows = allRows.map((r) => ({
        ...r,
        id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: SESSION_STATUS.SCHEDULED,
        colorIdx: r.color_idx,
        _optimistic: true,
      }));
      setUpcomingSessions(prev => [...prev, ...optimisticRows]);
      setPatients(prev => prev.map(p => p.id === patientId
        ? { ...p, sessions: newSessions, billed: newBilled } : p));
      await enqueue("sessions.bulk_insert", { rows: allRows });
      setMutating(false);
      return true;
    }
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    // patient.{sessions,billed} are recomputed by the trigger that fires
    // on the bulk insert above. Optimistic React state already mirrored
    // the expected values above; replace temp rows with server rows here.
    setUpcomingSessions(prev => [...prev, ...(data || []).map(r => ({ ...r, colorIdx: r.color_idx, modality: r.modality || "presencial" }))]);
    setPatients(prev => prev.map(p => p.id === patientId
      ? { ...p, sessions: newSessions, billed: newBilled } : p));
    setMutating(false);
    return true;
  }

  async function applyScheduleChange(patientId: string, { schedules, rate, effectiveDate, endDate }: { schedules: Schedule[]; rate?: number | string | null; effectiveDate: string; endDate?: string }) {
    const patient = patients.find(p => p.id === patientId);
    if (!patient || !effectiveDate || !schedules?.length) return false;

    setMutationError("");
    const effDate = parseLocalDate(effectiveDate);
    const newRate = Number(rate) || patient.rate;
    const primary = schedules[0];

    const toDelete = upcomingSessions.filter(s => {
      if (s.patient_id !== patientId || s.status !== SESSION_STATUS.SCHEDULED) return false;
      return parseShortDate(s.date) >= effDate;
    });
    // Strip temp ids — those rows haven't been persisted yet (their
    // insert is still in the queue). Local removal still happens.
    const toDeleteIds = toDelete.map(s => s.id).filter(id => !(typeof id === "string" && id.startsWith("temp-")));

    // Compute new recurring rows. Use local `patient` snapshot for
    // name/initials/color_idx — those don't change in this flow, only
    // rate/day/time do. Matches what the server would produce.
    const deletedIds = new Set(toDelete.map(s => s.id));
    const existingSlots = new Set(
      upcomingSessions
        .filter(s => s.patient_id === patientId && !deletedIds.has(s.id))
        .map(s => `${s.date}|${s.time}`)
    );
    const allRows: SessionInsertRow[] = [];
    for (const s of schedules) {
      const dur = Number(s.duration) > 0 ? Number(s.duration) : 60;
      const freq = s.frequency || "weekly";
      getRecurringDates(s.day, effectiveDate, endDate, freq).forEach(d => {
        const ds = formatShortDate(d);
        const slot = `${ds}|${s.time}`;
        if (!existingSlots.has(slot)) {
          allRows.push({ user_id: userId, patient_id: patientId, patient: patient.name,
            initials: patient.initials, time: s.time, day: s.day,
            date: ds, duration: dur, rate: newRate,
            modality: s.modality || "presencial",
            is_recurring: true,
            recurrence_frequency: freq,
            color_idx: patient.colorIdx || 0 });
          existingSlots.add(slot);
        }
      });
    }

    // Optimistic React state — same predicate-aware deltas the trigger
    // will compute server-side once the queue / network has run.
    const now = new Date();
    let adjustedBilled = patient.billed;
    let adjustedSessions = patient.sessions;
    if (toDelete.length > 0) {
      adjustedBilled -= toDelete.reduce((sum, s) => (
        sum + (sessionCountsTowardBalance(s, now) ? (s.rate ?? patient.rate ?? 0) : 0)
      ), 0);
      adjustedSessions -= toDelete.length;
      setUpcomingSessions(prev => prev.filter(s => !deletedIds.has(s.id)));
    }
    const countedDelta = allRows.reduce((sum, r) => (
      sum + (sessionCountsTowardBalance(r, now) ? (r.rate ?? newRate ?? 0) : 0)
    ), 0);
    const finalBilled = Math.max(0, adjustedBilled) + countedDelta;
    const finalSessions = Math.max(0, adjustedSessions) + allRows.length;
    setPatients(prev => prev.map(p => p.id === patientId
      ? { ...p, rate: newRate, day: primary.day, time: primary.time,
          billed: finalBilled, sessions: finalSessions }
      : p));

    const patientPatch = { rate: newRate, day: primary.day, time: primary.time };

    // Offline / transport-error: one queue entry runs the whole
    // multi-step flow on drain. Each step is idempotent (delete-by-id
    // no-ops, patient patch is the same value, bulk insert swallows
    // 23505) so retries are safe.
    if (isOffline()) {
      // Insert optimistic temp rows so the UI shows the new schedule
      // immediately. They get swapped for server rows on a subsequent
      // refetch (no per-row replay listener for bulk inserts — too
      // many temp ids to track individually).
      const optimisticRows = allRows.map((r) => ({
        ...r,
        id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: SESSION_STATUS.SCHEDULED,
        colorIdx: r.color_idx,
        _optimistic: true,
      }));
      if (optimisticRows.length > 0) {
        setUpcomingSessions(prev => [...prev, ...optimisticRows]);
      }
      await enqueue("sessions.apply_schedule_change", {
        patientId, userId, toDeleteIds, patientPatch, newRows: allRows,
      });
      return true;
    }

    setMutating(true);
    try {
      if (toDeleteIds.length > 0) {
        const { error } = await supabase.from("sessions").delete().eq("user_id", userId).in("id", toDeleteIds);
        if (error) { setMutating(false); setMutationError(error.message); return false; }
      }
      const { error: pErr } = await supabase.from("patients")
        .update(patientPatch).eq("id", patientId).eq("user_id", userId);
      if (pErr) { setMutating(false); setMutationError(pErr.message); return false; }

      if (allRows.length > 0) {
        const { data: sessData, error: sErr } = await supabase.from("sessions").insert(allRows as TablesInsert<"sessions">[]).select();
        if (sErr) { setMutating(false); setMutationError(sErr.message); return false; }
        // Counters maintained by trigger; replace local rows with the
        // server-assigned shape (real ids, server defaults).
        setUpcomingSessions(prev => [
          ...prev,
          ...sessData.map(r => ({ ...r, colorIdx: r.color_idx, modality: r.modality || "presencial" })),
        ]);
      }
      setMutating(false);
      return true;
    } catch {
      // Transport-level — queue the whole flow with optimistic temp
      // rows so the user's edit isn't lost.
      const optimisticRows = allRows.map((r) => ({
        ...r,
        id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: SESSION_STATUS.SCHEDULED,
        colorIdx: r.color_idx,
        _optimistic: true,
      }));
      if (optimisticRows.length > 0) {
        setUpcomingSessions(prev => [...prev, ...optimisticRows]);
      }
      await enqueue("sessions.apply_schedule_change", {
        patientId, userId, toDeleteIds, patientPatch, newRows: allRows,
      });
      setMutating(false);
      return true;
    }
  }

  async function finalizePatient(patientId: string, finishDate: string) {
    const patient = patients.find(p => p.id === patientId);
    if (!patient || !finishDate) return false;
    setMutationError("");
    const cutoff = parseLocalDate(finishDate);

    // Find scheduled sessions after the finish date.
    const toDelete = upcomingSessions.filter(s => {
      if (s.patient_id !== patientId || s.status !== SESSION_STATUS.SCHEDULED) return false;
      return parseShortDate(s.date) > cutoff;
    });
    // Strip temp ids — those rows haven't been inserted server-side
    // yet (their underlying queue entry is still pending), so there's
    // no real row to delete. Local removal still happens.
    const toDeleteIds = toDelete.map(s => s.id).filter(id => !(typeof id === "string" && id.startsWith("temp-")));

    let adjustedBilled = patient.billed;
    let adjustedSessions = patient.sessions;
    if (toDelete.length > 0) {
      const now = new Date();
      adjustedBilled -= toDelete.reduce((sum, s) => (
        sum + (sessionCountsTowardBalance(s, now) ? (s.rate ?? patient.rate ?? 0) : 0)
      ), 0);
      adjustedSessions -= toDelete.length;
      // Optimistic removal + status flip in local state.
      const removeIds = new Set(toDelete.map(s => s.id));
      setUpcomingSessions(prev => prev.filter(s => !removeIds.has(s.id)));
    }
    setPatients(prev => prev.map(p => p.id === patientId
      ? { ...p, status: PATIENT_STATUS.ENDED,
          billed: Math.max(0, adjustedBilled),
          sessions: Math.max(0, adjustedSessions) }
      : p));

    // Offline / transport-error: one queue entry runs the whole
    // multi-step flow on drain. The handler's two steps are each
    // idempotent (nothing-to-delete + already-ended are both no-ops),
    // so retries are safe.
    if (isOffline()) {
      await enqueue("sessions.finalize_patient", {
        patientId, userId, toDeleteIds, statusValue: PATIENT_STATUS.ENDED,
      });
      return true;
    }

    setMutating(true);
    try {
      if (toDeleteIds.length > 0) {
        const { error } = await supabase.from("sessions").delete().eq("user_id", userId).in("id", toDeleteIds);
        if (error) { setMutating(false); setMutationError(error.message); return false; }
      }
      const { error: pErr } = await supabase.from("patients")
        .update({ status: PATIENT_STATUS.ENDED })
        .eq("id", patientId).eq("user_id", userId);
      setMutating(false);
      if (pErr) { setMutationError(pErr.message); return false; }
      return true;
    } catch {
      // Transport failure — queue the full flow for retry.
      setMutating(false);
      await enqueue("sessions.finalize_patient", {
        patientId, userId, toDeleteIds, statusValue: PATIENT_STATUS.ENDED,
      });
      return true;
    }
  }

  // Generic write-with-optimistic-lock helper. Used by the four
  // non-status mutators below (modality, visit_type, rate, cancel
  // reason). All four are the same shape: patch one or two columns,
  // bump version, surface conflicts via reconcileSessionConflict, mirror
  // the new version locally on success. Returns true on success, false
  // on error/conflict — caller already updated optimistic state. The
  // helper handles revert + setMutationError on failure.
  async function writeSessionWithLock(sessionId: string, patch: Record<string, unknown>, prevSession: Session, onSuccess?: () => void | Promise<void>) {
    // Temp-id rows haven't drained yet — the underlying insert is in
    // the queue. Updating before that insert lands would target a non-
    // existent row. Apply optimistic locally only and skip the wire;
    // the user can re-edit after drain.
    const isOptimisticRow = typeof sessionId === "string" && sessionId.startsWith("temp-");
    if (isOptimisticRow) {
      if (typeof onSuccess === "function") await onSuccess();
      return true;
    }
    // Offline: queue without the version filter (last-write-wins on
    // replay) and return success. Optimistic state was already applied
    // by the caller. onSuccess (e.g. patient.billed adjustment in
    // updateSessionRate) still runs locally.
    const expectedVersion = prevSession.version ?? null;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await enqueue("sessions.update", { id: sessionId, userId, patch, enqueuedVersion: expectedVersion });
      if (typeof onSuccess === "function") await onSuccess();
      return true;
    }
    let q = supabase.from("sessions").update(patch as TablesUpdate<"sessions">).eq("id", sessionId).eq("user_id", userId);
    if (expectedVersion != null) q = q.eq("version", expectedVersion);
    let data, error;
    try {
      const res = await q.select("id");
      data = res.data; error = res.error;
    } catch {
      // Transport failure mid-flight — queue and keep optimistic state.
      await enqueue("sessions.update", { id: sessionId, userId, patch, enqueuedVersion: expectedVersion });
      if (typeof onSuccess === "function") await onSuccess();
      return true;
    }
    if (error) {
      setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? prevSession : s));
      setMutationError(error.message);
      return false;
    }
    if (expectedVersion != null && (!data || data.length === 0)) {
      await reconcileSessionConflict(sessionId, prevSession, null);
      return false;
    }
    setUpcomingSessions(prev => prev.map(s => s.id === sessionId
      ? { ...s, version: (prevSession.version ?? 0) + 1 }
      : s));
    if (typeof onSuccess === "function") await onSuccess();
    return true;
  }

  async function updateSessionModality(sessionId: string, modality: string) {
    const prevSession = upcomingSessions.find(s => s.id === sessionId);
    if (!prevSession) return false;
    setMutating(true);
    setMutationError("");
    // Optimistic — flip local state synchronously so the UI updates
    // without waiting for the round-trip; the helper reverts on error
    // or conflict.
    setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? { ...s, modality } : s));
    const ok = await writeSessionWithLock(sessionId, { modality }, prevSession);
    setMutating(false);
    return ok;
  }

  async function updateSessionVisitType(sessionId: string, visitType?: string | null) {
    // null clears the tag (returns the row to "Sin clasificar"). Any
    // other value must match the CHECK constraint set in migration
    // 041; the upstream UI uses the VISIT_TYPE enum so this is a
    // belt-and-suspenders rather than a user-input boundary.
    const next = visitType == null ? null : String(visitType);
    const prevSession = upcomingSessions.find(s => s.id === sessionId);
    if (!prevSession) return false;
    setMutating(true);
    setMutationError("");
    setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? { ...s, visit_type: next } : s));
    const ok = await writeSessionWithLock(sessionId, { visit_type: next }, prevSession);
    setMutating(false);
    return ok;
  }

  async function updateSessionRate(sessionId: string, newRate: number | string) {
    const rate = Number(newRate);
    // Allow any non-negative finite number. Zero is valid (pro-bono).
    if (!Number.isFinite(rate) || rate < 0) return false;
    const session = upcomingSessions.find(s => s.id === sessionId);
    if (!session) return false;
    const oldRate = session.rate != null ? session.rate : 0;
    const diff = rate - oldRate;

    setMutating(true);
    setMutationError("");
    // Optimistic — flip local rate so the form can dismiss; reverted
    // by writeSessionWithLock on error / conflict.
    setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? { ...s, rate } : s));
    // Optimistic patient.billed update — same predicate the SQL trigger
    // applies after the session UPDATE. The trigger persists; this is
    // purely for UI consistency until the next refetch.
    if (diff !== 0 && session.patient_id && sessionCountsTowardBalance(session)) {
      const patient = patients.find(p => p.id === session.patient_id);
      if (patient) {
        const newBilled = Math.max(0, patient.billed + diff);
        setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, billed: newBilled } : p));
      }
    }
    const ok = await writeSessionWithLock(sessionId, { rate }, session);
    setMutating(false);
    return ok;
  }

  async function updateCancelReason(sessionId: string, reason?: string | null) {
    const trimmed = (reason || "").trim();
    const prevSession = upcomingSessions.find(s => s.id === sessionId);
    if (!prevSession) return false;
    setMutating(true);
    setMutationError("");
    setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? { ...s, cancel_reason: trimmed || null } : s));
    const ok = await writeSessionWithLock(sessionId, { cancel_reason: trimmed || null }, prevSession);
    setMutating(false);
    return ok;
  }

  return { createSession, updateSessionStatus, deleteSession, softDeleteSession, rescheduleSession, generateRecurringSessions, applyScheduleChange, finalizePatient, updateSessionModality, updateSessionRate, updateSessionVisitType, updateCancelReason };
}
