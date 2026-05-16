import { supabase } from "../supabaseClient";
import { DAY_ORDER } from "../data/seedData";
import {
  PATIENT_STATUS,
  SESSION_STATUS,
} from "../data/constants";
import { getInitials, formatShortDate, parseShortDate, parseLocalDate } from "../utils/dates";
import { recalcPatientCounters } from "../utils/patients";
import { sessionCountsTowardBalance } from "../utils/accounting";
import { getRecurringDates } from "../utils/recurrence";

// Re-export for callers that historically imported it from this module.
export { getRecurringDates };

// Spanish copy for the "another tab/device wrote first" toast. Reused
// across every session-mutation path that runs the optimistic-locking
// guard from migration 065. Keep this string here so the message stays
// uniform — users see the same wording whether they conflict on status,
// reschedule, modality, rate, visit type, or cancel reason.
const CONFLICT_MSG = "Esta sesión se editó en otro lugar. Volvimos a cargarla — intenta de nuevo.";
const MISSING_MSG = "Esta sesión ya no existe.";

export function createSessionActions(userId, patients, setPatients, upcomingSessions, setUpcomingSessions, setMutating, setMutationError) {

  // Optimistic locking conflict handler — shared by every session-update
  // path. Called when a .eq("version", v) filter rejected the write (0
  // rows updated) or when the status RPC raises SQLSTATE 40001. Decides
  // between "row was edited elsewhere" (refetch + replace local state)
  // and "row no longer exists" (drop locally) by re-reading by id. Also
  // restores the prior patient row when the optimistic mutation touched
  // patient.billed.
  async function reconcileSessionConflict(sessionId, prevSession, prevPatient) {
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

  async function createSession({ patientName, date, time, duration, isTutor, tutorName, customRate, modality, visitType }) {
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
      : patient.initials;
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

    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase.from("sessions").insert({
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
    }).select().single();
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    // patient.sessions and patient.billed are maintained by
    // trg_sessions_recalc_counters (migration 069). The session INSERT
    // above fires the trigger which atomically recomputes both
    // counters. Local React state mirrors the expected post-trigger
    // values so the UI doesn't lag the round-trip — predicate gates
    // the billed bump the same way the SQL function does.
    const newSessions = patient.sessions + 1;
    const willCountNew = sessionCountsTowardBalance(
      { status: SESSION_STATUS.SCHEDULED, date: date.trim(), time: time.trim() },
    );
    const newBilled = willCountNew ? patient.billed + sessionRate : patient.billed;

    setUpcomingSessions(prev => [...prev, { ...data, colorIdx: data.color_idx, modality: data.modality || "presencial" }]);
    setPatients(prev => prev.map(p => p.id === patient.id
      ? { ...p, sessions: newSessions, billed: newBilled } : p));
    setMutating(false);
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
  async function updateSessionStatus(sessionId, status, charge, cancelReason) {
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
    (async () => {
      try {
        const { error } = await supabase.rpc("update_session_status_atomic", {
          p_session_id: sessionId,
          p_new_status: newStatus,
          p_cancel_reason: cancelReasonInput,
          p_expected_version: prevSession.version ?? null,
        });
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
        setMutationError(e?.message || "Network error");
      }
    })();

    return true;
  }

  async function deleteSession(sessionId) {
    const session = upcomingSessions.find(s => s.id === sessionId);
    setMutating(true);
    setMutationError("");
    const { error } = await supabase.from("sessions").delete().eq("id", sessionId).eq("user_id", userId);
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setUpcomingSessions(prev => prev.filter(s => s.id !== sessionId));

    // patient.sessions and patient.billed are recomputed by the trigger
    // (migration 069) that fired on the DELETE above. Optimistic React
    // state updates with the same predicate-aware decrement so the UI
    // is consistent until the next refetch.
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
    return true;
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
  async function rescheduleSession(sessionId, newDate, newTime, newDuration) {
    if (!newDate?.trim() || !newTime?.trim()) return false;
    const prevSession = upcomingSessions.find(s => s.id === sessionId);
    if (!prevSession) return false;

    const dateObj = parseShortDate(newDate);
    const dayName = DAY_ORDER[(dateObj.getDay() + 6) % 7];
    const patch = { date: newDate.trim(), time: newTime.trim(), day: dayName, status: SESSION_STATUS.SCHEDULED };
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

    (async () => {
      try {
        // Optimistic lock: .eq("version", v) → 0 rows updated when
        // another writer bumped version. .select("id") makes the
        // returned data array reflect actual rows updated; a length-0
        // result means the version filter rejected us.
        const expectedVersion = prevSession.version ?? null;
        let q = supabase.from("sessions").update(patch).eq("id", sessionId).eq("user_id", userId);
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
      } catch (e) {
        setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? prevSession : s));
        if (prevPatient) setPatients(prev => prev.map(p => p.id === prevPatient.id ? prevPatient : p));
        setMutationError(e?.message || "Network error");
      }
    })();

    return true;
  }

  async function generateRecurringSessions(patientId, schedules, startDate, endDate) {
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
    const allRows = [];
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

    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase.from("sessions").insert(allRows).select();
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    // patient.{sessions,billed} are recomputed by the trigger that fires
    // on the bulk insert above (once per row — see migration 069's
    // perf note). Optimistic React state mirrors the expected values.
    const now = new Date();
    const newSessions = patient.sessions + data.length;
    const countedDelta = data.reduce((sum, r) => (
      sum + (sessionCountsTowardBalance(r, now) ? (r.rate ?? patient.rate ?? 0) : 0)
    ), 0);
    const newBilled = patient.billed + countedDelta;

    setUpcomingSessions(prev => [...prev, ...data.map(r => ({ ...r, colorIdx: r.color_idx, modality: r.modality || "presencial" }))]);
    setPatients(prev => prev.map(p => p.id === patientId
      ? { ...p, sessions: newSessions, billed: newBilled } : p));
    setMutating(false);
    return true;
  }

  async function applyScheduleChange(patientId, { schedules, rate, effectiveDate, endDate }) {
    const patient = patients.find(p => p.id === patientId);
    if (!patient || !effectiveDate || !schedules?.length) return false;

    setMutating(true);
    setMutationError("");
    const effDate = parseLocalDate(effectiveDate);
    const newRate = Number(rate) || patient.rate;
    const primary = schedules[0];

    const toDelete = upcomingSessions.filter(s => {
      if (s.patient_id !== patientId || s.status !== SESSION_STATUS.SCHEDULED) return false;
      return parseShortDate(s.date) >= effDate;
    });

    let adjustedBilled = patient.billed;
    let adjustedSessions = patient.sessions;

    if (toDelete.length > 0) {
      const ids = toDelete.map(s => s.id);
      const { error } = await supabase.from("sessions").delete().eq("user_id", userId).in("id", ids);
      if (error) { setMutating(false); setMutationError(error.message); return false; }
      // Optimistic React state: same predicate-aware decrement the
      // trigger applied server-side.
      const now = new Date();
      adjustedBilled -= toDelete.reduce((sum, s) => (
        sum + (sessionCountsTowardBalance(s, now) ? (s.rate ?? patient.rate ?? 0) : 0)
      ), 0);
      adjustedSessions -= toDelete.length;
      setUpcomingSessions(prev => prev.filter(s => !ids.includes(s.id)));
    }

    // Patient patch carries rate + day + time (not trigger-maintained).
    // billed/sessions are recomputed by the trigger fires on the
    // session DELETE above.
    const patch = { rate: newRate, day: primary.day, time: primary.time };
    const { data: updated, error: pErr } = await supabase.from("patients")
      .update(patch).eq("id", patientId).eq("user_id", userId).select().single();
    if (pErr) { setMutating(false); setMutationError(pErr.message); return false; }
    // Server's updated row may not reflect the latest trigger output
    // (the trigger ran before this UPDATE); use locally-computed
    // counters for the optimistic snapshot.
    setPatients(prev => prev.map(p => p.id === patientId
      ? { ...updated, colorIdx: updated.color_idx,
          billed: Math.max(0, adjustedBilled),
          sessions: Math.max(0, adjustedSessions) }
      : p));

    // Exclude the rows we just deleted — the local `upcomingSessions` still
    // references them (setState hasn't flushed) and including their dates
    // would skip regenerating the same slots at the new rate. Dedup key
    // is (date, time), not date alone, so two schedules on the same day
    // at different times are both generated and a cancelled slot at one
    // time doesn't block a new slot at a different time. Mirrors
    // uniq_sessions_patient_date_time in the DB.
    const deletedIds = new Set(toDelete.map(s => s.id));
    const existingSlots = new Set(
      upcomingSessions
        .filter(s => s.patient_id === patientId && !deletedIds.has(s.id))
        .map(s => `${s.date}|${s.time}`)
    );
    const allRows = [];
    for (const s of schedules) {
      const dur = Number(s.duration) > 0 ? Number(s.duration) : 60;
      const freq = s.frequency || "weekly";
      getRecurringDates(s.day, effectiveDate, endDate, freq).forEach(d => {
        const ds = formatShortDate(d);
        const slot = `${ds}|${s.time}`;
        if (!existingSlots.has(slot)) {
          allRows.push({ user_id: userId, patient_id: patientId, patient: updated.name,
            initials: updated.initials, time: s.time, day: s.day,
            date: ds, duration: dur, rate: newRate,
            modality: s.modality || "presencial",
            // Schedule edit replays the recurring window — these rows
            // are the new canonical recurring schedule for the
            // patient.
            is_recurring: true,
            recurrence_frequency: freq,
            color_idx: updated.color_idx || 0 });
          existingSlots.add(slot);
        }
      });
    }

    if (allRows.length > 0) {
      const { data: sessData, error: sErr } = await supabase.from("sessions").insert(allRows).select();
      if (!sErr && sessData) {
        // Counters maintained by trigger on the bulk insert. Optimistic
        // React state mirrors the expected post-trigger values.
        const finalSessions = Math.max(0, adjustedSessions) + sessData.length;
        const nowSc = new Date();
        const countedDelta = sessData.reduce((sum, r) => (
          sum + (sessionCountsTowardBalance(r, nowSc) ? (r.rate ?? newRate ?? 0) : 0)
        ), 0);
        const finalBilled = Math.max(0, adjustedBilled) + countedDelta;
        setUpcomingSessions(prev => [...prev, ...sessData.map(r => ({ ...r, colorIdx: r.color_idx, modality: r.modality || "presencial" }))]);
        setPatients(prev => prev.map(p => p.id === patientId
          ? { ...p, sessions: finalSessions, billed: finalBilled } : p));
      }
    }

    setMutating(false);
    return true;
  }

  async function finalizePatient(patientId, finishDate) {
    const patient = patients.find(p => p.id === patientId);
    if (!patient || !finishDate) return false;
    setMutating(true);
    setMutationError("");
    const cutoff = parseLocalDate(finishDate);

    // Find scheduled sessions after the finish date
    const toDelete = upcomingSessions.filter(s => {
      if (s.patient_id !== patientId || s.status !== SESSION_STATUS.SCHEDULED) return false;
      return parseShortDate(s.date) > cutoff;
    });

    let adjustedBilled = patient.billed;
    let adjustedSessions = patient.sessions;

    if (toDelete.length > 0) {
      const ids = toDelete.map(s => s.id);
      const { error } = await supabase.from("sessions").delete().eq("user_id", userId).in("id", ids);
      if (error) { setMutating(false); setMutationError(error.message); return false; }
      // Predicate-aware billed-decrement. finalizePatient filters to
      // future-only scheduled rows (date > cutoff), so in practice
      // none of these were counted — but routing through the predicate
      // keeps the code uniform with the prime-directive formula.
      const now = new Date();
      adjustedBilled -= toDelete.reduce((sum, s) => (
        sum + (sessionCountsTowardBalance(s, now) ? (s.rate ?? patient.rate ?? 0) : 0)
      ), 0);
      adjustedSessions -= toDelete.length;
      setUpcomingSessions(prev => prev.filter(s => !ids.includes(s.id)));
    }

    // Patient patch carries only `status` — billed/sessions are
    // recomputed by the trigger on the session DELETE above.
    const { data: updated, error: pErr } = await supabase.from("patients")
      .update({ status: PATIENT_STATUS.ENDED })
      .eq("id", patientId).eq("user_id", userId).select().single();
    if (pErr) { setMutating(false); setMutationError(pErr.message); return false; }
    setPatients(prev => prev.map(p => p.id === patientId
      ? { ...updated, colorIdx: updated.color_idx,
          billed: Math.max(0, adjustedBilled),
          sessions: Math.max(0, adjustedSessions) }
      : p));

    setMutating(false);
    return true;
  }

  // Generic write-with-optimistic-lock helper. Used by the four
  // non-status mutators below (modality, visit_type, rate, cancel
  // reason). All four are the same shape: patch one or two columns,
  // bump version, surface conflicts via reconcileSessionConflict, mirror
  // the new version locally on success. Returns true on success, false
  // on error/conflict — caller already updated optimistic state. The
  // helper handles revert + setMutationError on failure.
  async function writeSessionWithLock(sessionId, patch, prevSession, onSuccess) {
    const expectedVersion = prevSession.version ?? null;
    let q = supabase.from("sessions").update(patch).eq("id", sessionId).eq("user_id", userId);
    if (expectedVersion != null) q = q.eq("version", expectedVersion);
    const { data, error } = await q.select("id");
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

  async function updateSessionModality(sessionId, modality) {
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

  async function updateSessionVisitType(sessionId, visitType) {
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

  async function updateSessionRate(sessionId, newRate) {
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

  async function updateCancelReason(sessionId, reason) {
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

  return { createSession, updateSessionStatus, deleteSession, rescheduleSession, generateRecurringSessions, applyScheduleChange, finalizePatient, updateSessionModality, updateSessionRate, updateSessionVisitType, updateCancelReason };
}
