import { supabase } from "../supabaseClient";
import { DAY_ORDER } from "../data/seedData";
import {
  PATIENT_STATUS,
  SESSION_STATUS,
} from "../data/constants";
import { getInitials, formatShortDate, parseShortDate, parseLocalDate } from "../utils/dates";
import { recalcPatientCounters } from "../utils/patients";
import { getRecurringDates } from "../utils/recurrence";

// Re-export for callers that historically imported it from this module.
export { getRecurringDates };

export function createSessionActions(userId, patients, setPatients, upcomingSessions, setUpcomingSessions, setMutating, setMutationError) {

  async function createSession({ patientName, date, time, duration, isTutor, tutorName, customRate, modality }) {
    if (!patientName?.trim() || !date?.trim() || !time?.trim()) return false;
    const patient = patients.find(p => p.name === patientName);
    if (!patient) return false;

    const dateObj = parseShortDate(date);
    const dayName = DAY_ORDER[(dateObj.getDay() + 6) % 7];

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
    // didn't provide a rate or passed a non-numeric value.
    const parsedCustomRate = customRate == null || customRate === "" ? NaN : Number(customRate);
    const sessionRate = Number.isFinite(parsedCustomRate) && parsedCustomRate >= 0
      ? parsedCustomRate
      : patient.rate;
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

    const newSessions = patient.sessions + 1;
    const newBilled = patient.billed + sessionRate;
    const { error: pErr } = await supabase.from("patients")
      .update({ sessions: newSessions, billed: newBilled })
      .eq("id", patient.id);

    setUpcomingSessions(prev => [...prev, { ...data, colorIdx: data.color_idx, modality: data.modality || "presencial" }]);
    if (pErr) {
      const fixed = await recalcPatientCounters(patient.id);
      if (fixed) setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, ...fixed } : p));
    } else {
      setPatients(prev => prev.map(p => p.id === patient.id
        ? { ...p, sessions: newSessions, billed: newBilled } : p));
    }
    setMutating(false);
    return true;
  }

  // Optimistic: local state flips immediately and the function returns
  // truthy in the next microtask — the cancel/reschedule sheet can
  // dismiss in the same visual frame. Network fires in the background;
  // on error we revert both session status and patient.billed and
  // raise the mutationError (surfaces as the app-level error toast).
  async function updateSessionStatus(sessionId, status, charge, cancelReason) {
    const session = upcomingSessions.find(s => s.id === sessionId);
    if (!session) return false;
    const newStatus = (status === SESSION_STATUS.CANCELLED && charge) ? SESSION_STATUS.CHARGED : status;
    const update = { status: newStatus };
    if (cancelReason !== undefined) update.cancel_reason = cancelReason || null;
    if (newStatus === SESSION_STATUS.SCHEDULED || newStatus === SESSION_STATUS.COMPLETED) update.cancel_reason = null;

    const oldStatus = session.status;
    const wasCancelled = oldStatus === SESSION_STATUS.CANCELLED;
    const nowCancelled = newStatus === SESSION_STATUS.CANCELLED;
    const prevSession = { ...session };
    const patient = session.patient_id ? patients.find(p => p.id === session.patient_id) : null;
    const prevPatient = patient ? { ...patient } : null;

    // Compute the billed delta once so both the optimistic update and
    // the eventual server write agree on the same target number.
    let targetBilled = null;
    if (patient && wasCancelled !== nowCancelled) {
      const sessRate = session.rate != null ? session.rate : patient.rate;
      targetBilled = nowCancelled
        ? Math.max(0, patient.billed - sessRate)
        : patient.billed + sessRate;
    }

    // Apply optimistic state now.
    setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? { ...s, ...update } : s));
    if (patient && targetBilled != null) {
      setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, billed: targetBilled } : p));
    }
    setMutationError("");

    // Fire network in the background. Any failure → revert both tables.
    // try/catch covers genuinely unexpected throws (the supabase-js client
    // returns `{ error }` rather than throwing in normal failure modes,
    // but we don't want a silent unhandled rejection to leave optimistic
    // state in place if something exotic blows up).
    (async () => {
      try {
        const { error } = await supabase.from("sessions")
          .update(update).eq("id", sessionId).eq("user_id", userId);
        if (error) {
          setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? prevSession : s));
          if (prevPatient) setPatients(prev => prev.map(p => p.id === prevPatient.id ? prevPatient : p));
          setMutationError(error.message);
          return;
        }
        if (patient && targetBilled != null) {
          const { error: pErr } = await supabase.from("patients")
            .update({ billed: targetBilled }).eq("id", patient.id).eq("user_id", userId);
          if (pErr) {
            const fixed = await recalcPatientCounters(patient.id);
            if (fixed) setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, ...fixed } : p));
          }
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

    if (session?.patient_id) {
      const patient = patients.find(p => p.id === session.patient_id);
      if (patient) {
        const sessRate = session.rate != null ? session.rate : patient.rate;
        // Cancelled sessions were already removed from billed when they were
        // cancelled. Subtracting again here would double-count and drive
        // amountDue below reality.
        const wasBilled = session.status !== SESSION_STATUS.CANCELLED;
        const newSessions = Math.max(0, patient.sessions - 1);
        const newBilled = wasBilled
          ? Math.max(0, patient.billed - sessRate)
          : patient.billed;
        const { error: pErr } = await supabase.from("patients")
          .update({ sessions: newSessions, billed: newBilled })
          .eq("id", patient.id).eq("user_id", userId);
        if (pErr) {
          const fixed = await recalcPatientCounters(patient.id);
          if (fixed) setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, ...fixed } : p));
        } else {
          setPatients(prev => prev.map(p => p.id === patient.id
            ? { ...p, sessions: newSessions, billed: newBilled } : p));
        }
      }
    }
    return true;
  }

  // Optimistic: updates local state immediately so the SessionSheet
  // can dismiss without waiting on the network round-trip. Reverts
  // the session row on server error and surfaces it via mutationError.
  async function rescheduleSession(sessionId, newDate, newTime, newDuration) {
    if (!newDate?.trim() || !newTime?.trim()) return false;
    const prevSession = upcomingSessions.find(s => s.id === sessionId);
    if (!prevSession) return false;

    const dateObj = parseShortDate(newDate);
    const dayName = DAY_ORDER[(dateObj.getDay() + 6) % 7];
    const patch = { date: newDate.trim(), time: newTime.trim(), day: dayName, status: SESSION_STATUS.SCHEDULED };
    if (newDuration != null && Number(newDuration) > 0) patch.duration = Number(newDuration);

    setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? { ...s, ...patch } : s));
    setMutationError("");

    (async () => {
      try {
        const { error } = await supabase.from("sessions").update(patch).eq("id", sessionId).eq("user_id", userId);
        if (error) {
          setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? prevSession : s));
          setMutationError(error.message);
        }
      } catch (e) {
        setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? prevSession : s));
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
      getRecurringDates(s.day, startDate, endDate).forEach(d => {
        const ds = formatShortDate(d);
        const slot = `${ds}|${s.time}`;
        if (existingSlots.has(slot)) return;
        allRows.push({ user_id: userId, patient_id: patient.id, patient: patient.name,
          initials: patient.initials, time: s.time, day: s.day,
          date: ds, duration: dur, rate: patient.rate,
          modality: s.modality || "presencial",
          color_idx: patient.colorIdx || 0 });
        existingSlots.add(slot);
      });
    }
    if (allRows.length === 0) return false;

    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase.from("sessions").insert(allRows).select();
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    const newSessions = patient.sessions + data.length;
    const newBilled = patient.billed + patient.rate * data.length;
    const { error: pErr } = await supabase.from("patients")
      .update({ sessions: newSessions, billed: newBilled })
      .eq("id", patient.id).eq("user_id", userId);

    setUpcomingSessions(prev => [...prev, ...data.map(r => ({ ...r, colorIdx: r.color_idx, modality: r.modality || "presencial" }))]);
    if (pErr) {
      const fixed = await recalcPatientCounters(patient.id);
      if (fixed) setPatients(prev => prev.map(p => p.id === patientId ? { ...p, ...fixed } : p));
    } else {
      setPatients(prev => prev.map(p => p.id === patientId
        ? { ...p, sessions: newSessions, billed: newBilled } : p));
    }
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
      adjustedBilled -= toDelete.reduce((sum, s) => sum + (s.rate != null ? s.rate : patient.rate), 0);
      adjustedSessions -= toDelete.length;
      setUpcomingSessions(prev => prev.filter(s => !ids.includes(s.id)));
    }

    const patch = { rate: newRate, day: primary.day, time: primary.time,
      billed: Math.max(0, adjustedBilled), sessions: Math.max(0, adjustedSessions) };
    const { data: updated, error: pErr } = await supabase.from("patients")
      .update(patch).eq("id", patientId).eq("user_id", userId).select().single();
    if (pErr) { setMutating(false); setMutationError(pErr.message); return false; }
    setPatients(prev => prev.map(p => p.id === patientId ? { ...updated, colorIdx: updated.color_idx } : p));

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
      getRecurringDates(s.day, effectiveDate, endDate).forEach(d => {
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
            color_idx: updated.color_idx || 0 });
          existingSlots.add(slot);
        }
      });
    }

    if (allRows.length > 0) {
      const { data: sessData, error: sErr } = await supabase.from("sessions").insert(allRows).select();
      if (!sErr && sessData) {
        const finalSessions = (updated.sessions || 0) + sessData.length;
        const finalBilled = (updated.billed || 0) + newRate * sessData.length;
        const { error: pErr2 } = await supabase.from("patients").update({ sessions: finalSessions, billed: finalBilled }).eq("id", patientId).eq("user_id", userId);
        setUpcomingSessions(prev => [...prev, ...sessData.map(r => ({ ...r, colorIdx: r.color_idx, modality: r.modality || "presencial" }))]);
        if (pErr2) {
          const fixed = await recalcPatientCounters(patientId);
          if (fixed) setPatients(prev => prev.map(p => p.id === patientId ? { ...p, ...fixed } : p));
        } else {
          setPatients(prev => prev.map(p => p.id === patientId ? { ...p, sessions: finalSessions, billed: finalBilled } : p));
        }
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
      adjustedBilled -= toDelete.reduce((sum, s) => sum + (s.rate != null ? s.rate : patient.rate), 0);
      adjustedSessions -= toDelete.length;
      setUpcomingSessions(prev => prev.filter(s => !ids.includes(s.id)));
    }

    const { data: updated, error: pErr } = await supabase.from("patients")
      .update({ status: PATIENT_STATUS.ENDED, billed: Math.max(0, adjustedBilled), sessions: Math.max(0, adjustedSessions) })
      .eq("id", patientId).eq("user_id", userId).select().single();
    if (pErr) { setMutating(false); setMutationError(pErr.message); return false; }
    setPatients(prev => prev.map(p => p.id === patientId ? { ...updated, colorIdx: updated.color_idx } : p));

    setMutating(false);
    return true;
  }

  async function updateSessionModality(sessionId, modality) {
    setMutating(true);
    setMutationError("");
    const { error } = await supabase.from("sessions").update({ modality }).eq("id", sessionId).eq("user_id", userId);
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? { ...s, modality } : s));
    return true;
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
    const { error } = await supabase.from("sessions").update({ rate }).eq("id", sessionId).eq("user_id", userId);
    if (error) { setMutating(false); setMutationError(error.message); return false; }
    setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? { ...s, rate } : s));

    // Adjust patient billed if session is not cancelled (cancelled sessions don't count toward billed)
    if (diff !== 0 && session.patient_id && session.status !== SESSION_STATUS.CANCELLED) {
      const patient = patients.find(p => p.id === session.patient_id);
      if (patient) {
        const newBilled = Math.max(0, patient.billed + diff);
        const { error: pErr } = await supabase.from("patients").update({ billed: newBilled }).eq("id", patient.id).eq("user_id", userId);
        if (pErr) {
          const fixed = await recalcPatientCounters(patient.id);
          if (fixed) setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, ...fixed } : p));
        } else {
          setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, billed: newBilled } : p));
        }
      }
    }

    setMutating(false);
    return true;
  }

  async function updateCancelReason(sessionId, reason) {
    const trimmed = (reason || "").trim();
    setMutating(true);
    setMutationError("");
    const { error } = await supabase.from("sessions")
      .update({ cancel_reason: trimmed || null })
      .eq("id", sessionId).eq("user_id", userId);
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? { ...s, cancel_reason: trimmed || null } : s));
    return true;
  }

  return { createSession, updateSessionStatus, deleteSession, rescheduleSession, generateRecurringSessions, applyScheduleChange, finalizePatient, updateSessionModality, updateSessionRate, updateCancelReason };
}
