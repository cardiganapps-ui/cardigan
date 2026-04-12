import { supabase } from "../supabaseClient";
import { DAY_ORDER } from "../data/seedData";
import {
  PATIENT_STATUS,
  RECURRENCE_WINDOW_WEEKS,
  SESSION_STATUS,
} from "../data/constants";
import { SHORT_MONTHS, getInitials, formatShortDate, parseShortDate, parseLocalDate, toISODate } from "../utils/dates";

const DAY_TO_JS = { "Lunes":1, "Martes":2, "Miércoles":3, "Jueves":4, "Viernes":5, "Sábado":6, "Domingo":0 };

export function getRecurringDates(dayName, startDateStr, endDateStr) {
  const target = DAY_TO_JS[dayName];
  if (target == null) return [];
  const start = parseLocalDate(startDateStr);
  let diff = target - start.getDay();
  if (diff < 0) diff += 7;
  const end = endDateStr ? parseLocalDate(endDateStr) : new Date(start);
  if (!endDateStr) end.setDate(end.getDate() + RECURRENCE_WINDOW_WEEKS * 7);
  const dates = [];
  const current = new Date(start);
  current.setDate(start.getDate() + diff);
  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 7);
  }
  return dates;
}

export function createSessionActions(userId, patients, setPatients, upcomingSessions, setUpcomingSessions, setMutating, setMutationError) {

  async function createSession({ patientName, date, time, isTutor, tutorName, customRate }) {
    if (!patientName?.trim() || !date?.trim() || !time?.trim()) return false;
    const patient = patients.find(p => p.name === patientName);
    if (!patient) return false;

    const [dayNum, monthStr] = date.split(" ");
    const monthIdx = SHORT_MONTHS.indexOf(monthStr);
    const year = new Date().getFullYear();
    const dateObj = new Date(year, monthIdx >= 0 ? monthIdx : 0, parseInt(dayNum) || 1);
    const dayName = DAY_ORDER[(dateObj.getDay() + 6) % 7];

    const sessionInitials = isTutor
      ? "T·" + getInitials(tutorName || patient.parent || "Tutor")
      : patient.initials;
    const sessionRate = (customRate != null && Number(customRate) > 0) ? Number(customRate) : patient.rate;

    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase.from("sessions").insert({
      user_id: userId, patient_id: patient.id,
      patient: patientName.trim(), initials: sessionInitials,
      time: time.trim(), day: dayName, date: date.trim(),
      color_idx: patient.colorIdx || 0,
    }).select().single();
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    const newSessions = patient.sessions + 1;
    const newBilled = patient.billed + sessionRate;
    await supabase.from("patients")
      .update({ sessions: newSessions, billed: newBilled })
      .eq("id", patient.id);

    setUpcomingSessions(prev => [...prev, { ...data, colorIdx: data.color_idx }]);
    setPatients(prev => prev.map(p => p.id === patient.id
      ? { ...p, sessions: newSessions, billed: newBilled } : p));
    setMutating(false);
    return true;
  }

  async function updateSessionStatus(sessionId, status, charge, cancelReason) {
    setMutating(true);
    setMutationError("");
    const newStatus = (status === SESSION_STATUS.CANCELLED && charge) ? SESSION_STATUS.CHARGED : status;
    const update = { status: newStatus };
    if (cancelReason !== undefined) update.cancel_reason = cancelReason || null;
    if (newStatus === SESSION_STATUS.SCHEDULED || newStatus === SESSION_STATUS.COMPLETED) update.cancel_reason = null;
    const { error } = await supabase.from("sessions")
      .update(update).eq("id", sessionId);
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? { ...s, ...update } : s));
    return true;
  }

  async function deleteSession(sessionId) {
    const session = upcomingSessions.find(s => s.id === sessionId);
    setMutating(true);
    setMutationError("");
    const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setUpcomingSessions(prev => prev.filter(s => s.id !== sessionId));

    if (session?.patient_id) {
      const patient = patients.find(p => p.id === session.patient_id);
      if (patient) {
        const newSessions = Math.max(0, patient.sessions - 1);
        const newBilled = Math.max(0, patient.billed - patient.rate);
        await supabase.from("patients")
          .update({ sessions: newSessions, billed: newBilled })
          .eq("id", patient.id);
        setPatients(prev => prev.map(p => p.id === patient.id
          ? { ...p, sessions: newSessions, billed: newBilled } : p));
      }
    }
    return true;
  }

  async function rescheduleSession(sessionId, newDate, newTime) {
    if (!newDate?.trim() || !newTime?.trim()) return false;
    const [dayNum, monthStr] = newDate.split(" ");
    const monthIdx = SHORT_MONTHS.indexOf(monthStr);
    const year = new Date().getFullYear();
    const dateObj = new Date(year, monthIdx >= 0 ? monthIdx : 0, parseInt(dayNum) || 1);
    const dayName = DAY_ORDER[(dateObj.getDay() + 6) % 7];

    setMutating(true);
    setMutationError("");
    const { error } = await supabase.from("sessions")
      .update({ date: newDate.trim(), time: newTime.trim(), day: dayName, status: SESSION_STATUS.SCHEDULED })
      .eq("id", sessionId);
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setUpcomingSessions(prev => prev.map(s => s.id === sessionId
      ? { ...s, date: newDate.trim(), time: newTime.trim(), day: dayName, status: SESSION_STATUS.SCHEDULED } : s));
    return true;
  }

  async function generateRecurringSessions(patientId, schedules, startDate, endDate) {
    const patient = patients.find(p => p.id === patientId);
    if (!patient || !schedules?.length || !startDate) return false;

    const allRows = [];
    for (const s of schedules) {
      getRecurringDates(s.day, startDate, endDate).forEach(d =>
        allRows.push({ user_id: userId, patient_id: patient.id, patient: patient.name,
          initials: patient.initials, time: s.time, day: s.day,
          date: formatShortDate(d), color_idx: patient.colorIdx || 0 }));
    }
    if (allRows.length === 0) return false;

    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase.from("sessions").insert(allRows).select();
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    const newSessions = patient.sessions + data.length;
    const newBilled = patient.billed + patient.rate * data.length;
    await supabase.from("patients")
      .update({ sessions: newSessions, billed: newBilled })
      .eq("id", patient.id);

    setUpcomingSessions(prev => [...prev, ...data.map(r => ({ ...r, colorIdx: r.color_idx }))]);
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
      const { error } = await supabase.from("sessions").delete().in("id", ids);
      if (error) { setMutating(false); setMutationError(error.message); return false; }
      adjustedBilled -= toDelete.length * patient.rate;
      adjustedSessions -= toDelete.length;
      setUpcomingSessions(prev => prev.filter(s => !ids.includes(s.id)));
    }

    const patch = { rate: newRate, day: primary.day, time: primary.time,
      billed: Math.max(0, adjustedBilled), sessions: Math.max(0, adjustedSessions) };
    const { data: updated, error: pErr } = await supabase.from("patients")
      .update(patch).eq("id", patientId).select().single();
    if (pErr) { setMutating(false); setMutationError(pErr.message); return false; }
    setPatients(prev => prev.map(p => p.id === patientId ? { ...updated, colorIdx: updated.color_idx } : p));

    const existingDates = new Set(upcomingSessions.filter(s => s.patient_id === patientId).map(s => s.date));
    const allRows = [];
    for (const s of schedules) {
      getRecurringDates(s.day, effectiveDate, endDate).forEach(d => {
        const ds = formatShortDate(d);
        if (!existingDates.has(ds)) {
          allRows.push({ user_id: userId, patient_id: patientId, patient: updated.name,
            initials: updated.initials, time: s.time, day: s.day,
            date: ds, color_idx: updated.color_idx || 0 });
          existingDates.add(ds);
        }
      });
    }

    if (allRows.length > 0) {
      const { data: sessData, error: sErr } = await supabase.from("sessions").insert(allRows).select();
      if (!sErr && sessData) {
        const finalSessions = (updated.sessions || 0) + sessData.length;
        const finalBilled = (updated.billed || 0) + newRate * sessData.length;
        await supabase.from("patients").update({ sessions: finalSessions, billed: finalBilled }).eq("id", patientId);
        setUpcomingSessions(prev => [...prev, ...sessData.map(r => ({ ...r, colorIdx: r.color_idx }))]);
        setPatients(prev => prev.map(p => p.id === patientId ? { ...p, sessions: finalSessions, billed: finalBilled } : p));
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
      const { error } = await supabase.from("sessions").delete().in("id", ids);
      if (error) { setMutating(false); setMutationError(error.message); return false; }
      adjustedBilled -= toDelete.length * patient.rate;
      adjustedSessions -= toDelete.length;
      setUpcomingSessions(prev => prev.filter(s => !ids.includes(s.id)));
    }

    const { data: updated, error: pErr } = await supabase.from("patients")
      .update({ status: PATIENT_STATUS.ENDED, billed: Math.max(0, adjustedBilled), sessions: Math.max(0, adjustedSessions) })
      .eq("id", patientId).select().single();
    if (pErr) { setMutating(false); setMutationError(pErr.message); return false; }
    setPatients(prev => prev.map(p => p.id === patientId ? { ...updated, colorIdx: updated.color_idx } : p));

    setMutating(false);
    return true;
  }

  return { createSession, updateSessionStatus, deleteSession, rescheduleSession, generateRecurringSessions, applyScheduleChange, finalizePatient };
}
