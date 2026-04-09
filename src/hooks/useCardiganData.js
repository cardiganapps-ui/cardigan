import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "../supabaseClient";
import { DAY_ORDER } from "../data/seedData";
import { formatShortDate } from "../data/api";

function getInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function mapRows(rows) {
  return (rows || []).map(r => ({ ...r, colorIdx: r.color_idx }));
}

const DAY_TO_JS = { "Lunes":1, "Martes":2, "Miércoles":3, "Jueves":4, "Viernes":5, "Sábado":6, "Domingo":0 };

function parseLocalDate(str) {
  const [y, m, d] = str.split("-");
  return new Date(+y, +m - 1, +d);
}

function getRecurringDates(dayName, startDateStr, endDateStr) {
  const target = DAY_TO_JS[dayName];
  if (target == null) return [];
  const start = parseLocalDate(startDateStr);
  let diff = target - start.getDay();
  if (diff < 0) diff += 7;

  const end = endDateStr ? parseLocalDate(endDateStr) : new Date(start);
  if (!endDateStr) end.setDate(end.getDate() + 12 * 7);

  const dates = [];
  const current = new Date(start);
  current.setDate(start.getDate() + diff);
  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 7);
  }
  return dates;
}

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function parseShortDate(str) {
  const [dayNum, mon] = str.split(" ");
  const mIdx = SHORT_MONTHS.indexOf(mon);
  return new Date(new Date().getFullYear(), mIdx >= 0 ? mIdx : 0, parseInt(dayNum) || 1);
}

const ADMIN_EMAIL = "gaxioladiego@gmail.com";

export function isAdmin(user) {
  return user?.email === ADMIN_EMAIL;
}

export async function fetchAllAccounts() {
  // Admin-only: fetches all data to derive unique user accounts with stats
  const [pRes, sRes, pmRes] = await Promise.all([
    supabase.from("patients").select("user_id, name, created_at").order("created_at"),
    supabase.from("sessions").select("user_id").order("created_at"),
    supabase.from("payments").select("user_id, amount").order("created_at"),
  ]);
  if (!pRes.data) return [];
  const accounts = new Map();
  (pRes.data || []).forEach(p => {
    if (!accounts.has(p.user_id)) {
      accounts.set(p.user_id, { userId: p.user_id, patients: [], sessions: 0, totalPaid: 0, firstSeen: p.created_at });
    }
    accounts.get(p.user_id).patients.push(p.name);
  });
  (sRes.data || []).forEach(s => {
    if (accounts.has(s.user_id)) accounts.get(s.user_id).sessions++;
  });
  (pmRes.data || []).forEach(p => {
    if (accounts.has(p.user_id)) accounts.get(p.user_id).totalPaid += p.amount;
  });
  return [...accounts.values()];
}

export function useCardiganData(user, viewAsUserId) {
  const userId = viewAsUserId || user?.id;
  const readOnly = !!viewAsUserId;
  const [patients, setPatients] = useState([]);
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    const q = (table) => {
      let query = supabase.from(table).select("*");
      if (readOnly) query = query.eq("user_id", userId);
      return query;
    };
    const [pRes, sRes, pmRes, nRes] = await Promise.all([
      q("patients").order("name"),
      q("sessions").order("created_at"),
      q("payments").order("created_at", { ascending: false }),
      q("notes").order("updated_at", { ascending: false }),
    ]);

    let pData = mapRows(pRes.data);
    let sData = mapRows(sRes.data);

    // Auto-extend recurring sessions for active patients (skip in read-only)
    if (userId && !readOnly) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const threshold = new Date(today);
      threshold.setDate(today.getDate() + 28); // extend when < 4 weeks remain
      const extendEnd = toISODate(new Date(today.getTime() + 12 * 7 * 86400000));
      let didExtend = false;

      for (const patient of pData) {
        if (patient.status !== "active") continue;
        const allPSess = sData.filter(s => s.patient_id === patient.id);
        if (allPSess.length === 0) continue;
        const activePSess = allPSess.filter(s => s.status !== "cancelled" && s.status !== "charged");

        // Infer schedules from all sessions (pattern stays same regardless of status)
        const schedMap = new Map();
        allPSess.forEach(s => schedMap.set(`${s.day}|${s.time}`, { day: s.day, time: s.time }));

        // Find latest active session date; skip all existing dates for dedup
        const existingDates = new Set(allPSess.map(s => s.date));
        let latest = null;
        activePSess.forEach(s => {
          const d = parseShortDate(s.date);
          if (!latest || d > latest) latest = d;
        });

        if (!latest || latest > threshold) continue;

        // Generate from day after latest to 12 weeks from today
        const nextDay = new Date(latest);
        nextDay.setDate(nextDay.getDate() + 1);
        const rows = [];
        for (const sched of schedMap.values()) {
          getRecurringDates(sched.day, toISODate(nextDay), extendEnd).forEach(d => {
            const ds = formatShortDate(d);
            if (!existingDates.has(ds)) {
              rows.push({ user_id: userId, patient_id: patient.id, patient: patient.name,
                initials: patient.initials, time: sched.time, day: sched.day,
                date: ds, color_idx: patient.color_idx || 0 });
              existingDates.add(ds);
            }
          });
        }

        if (rows.length > 0) {
          const { data, error } = await supabase.from("sessions").insert(rows).select();
          if (!error && data) {
            await supabase.from("patients")
              .update({ sessions: patient.sessions + data.length, billed: patient.billed + patient.rate * data.length })
              .eq("id", patient.id);
            didExtend = true;
          }
        }
      }

      if (didExtend) {
        const [pRes2, sRes2] = await Promise.all([
          supabase.from("patients").select("*").order("name"),
          supabase.from("sessions").select("*").order("created_at"),
        ]);
        pData = mapRows(pRes2.data);
        sData = mapRows(sRes2.data);
      }
    }

    setPatients(pData);
    setUpcomingSessions(sData);
    setPayments(mapRows(pmRes.data));
    setNotes(nRes.data || []);
    setLoading(false);
  }, [userId, readOnly]);

  useEffect(() => { refresh(); }, [refresh]);

  /* ── PATIENTS ── */
  async function createPatient({ name, parent, rate, schedules, recurring, startDate, endDate }) {
    if (!name?.trim()) return false;
    if (patients.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
      setMutationError("Ya existe un paciente con ese nombre.");
      return false;
    }
    const sched = schedules?.length ? schedules : [{ day: "Lunes", time: "16:00" }];
    const patientRate = Number(rate) || 0;
    const colorIdx = patients.length % 7;

    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase.from("patients").insert({
      user_id: userId,
      name: name.trim(),
      parent: parent?.trim() || "",
      initials: getInitials(name),
      rate: patientRate,
      day: sched[0].day,
      time: sched[0].time,
      color_idx: colorIdx,
    }).select().single();
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    const newPatient = { ...data, colorIdx: data.color_idx };
    let updatedPatient = newPatient;

    if (recurring && startDate) {
      const allRows = [];
      for (const s of sched) {
        getRecurringDates(s.day, startDate, endDate).forEach(d =>
          allRows.push({ user_id: userId, patient_id: data.id, patient: name.trim(),
            initials: getInitials(name), time: s.time, day: s.day,
            date: formatShortDate(d), color_idx: colorIdx }));
      }
      if (allRows.length > 0) {
        const { data: sessData, error: sessErr } = await supabase.from("sessions").insert(allRows).select();
        if (!sessErr && sessData) {
          const n = sessData.length;
          const billed = patientRate * n;
          await supabase.from("patients").update({ sessions: n, billed }).eq("id", data.id);
          updatedPatient = { ...newPatient, sessions: n, billed };
          setUpcomingSessions(prev => [...prev, ...sessData.map(r => ({ ...r, colorIdx: r.color_idx }))]);
        }
      }
    }

    setPatients(prev => [...prev, updatedPatient].sort((a, b) => a.name.localeCompare(b.name)));
    setMutating(false);
    return true;
  }

  async function updatePatient(id, updates) {
    if (updates.name) {
      const dupe = patients.some(p => p.id !== id && p.name.toLowerCase() === updates.name.trim().toLowerCase());
      if (dupe) { setMutationError("Ya existe un paciente con ese nombre."); return false; }
    }
    setMutating(true);
    setMutationError("");
    const patch = { ...updates };
    if (patch.name) patch.initials = getInitials(patch.name);
    const { data, error } = await supabase.from("patients")
      .update(patch).eq("id", id).select().single();
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setPatients(prev => prev.map(p => p.id === id ? { ...data, colorIdx: data.color_idx } : p));
    return true;
  }

  async function deletePatient(id) {
    setMutating(true);
    setMutationError("");
    const { error } = await supabase.from("patients").delete().eq("id", id);
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setPatients(prev => prev.filter(p => p.id !== id));
    setUpcomingSessions(prev => prev.filter(s => s.patient_id !== id));
    return true;
  }

  /* ── SESSIONS ── */
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
      user_id: userId,
      patient_id: patient.id,
      patient: patientName.trim(),
      initials: sessionInitials,
      time: time.trim(),
      day: dayName,
      date: date.trim(),
      color_idx: patient.colorIdx || 0,
    }).select().single();
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    // Update patient's session count and billed amount
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

  async function updateSessionStatus(sessionId, status, charge) {
    setMutating(true);
    setMutationError("");
    const newStatus = (status === "cancelled" && charge) ? "charged" : status;
    const { error } = await supabase.from("sessions")
      .update({ status: newStatus }).eq("id", sessionId);
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? { ...s, status: newStatus } : s));
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

    // Reverse billed amount if session had a linked patient
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
      .update({ date: newDate.trim(), time: newTime.trim(), day: dayName, status: "scheduled" })
      .eq("id", sessionId);
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setUpcomingSessions(prev => prev.map(s => s.id === sessionId
      ? { ...s, date: newDate.trim(), time: newTime.trim(), day: dayName, status: "scheduled" } : s));
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
    setPatients(prev => prev.map(p => p.id === patient.id
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

    // 1. Delete future scheduled sessions from effective date
    const toDelete = upcomingSessions.filter(s => {
      if (s.patient_id !== patientId || s.status !== "scheduled") return false;
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

    // 2. Update patient record
    const patch = { rate: newRate, day: primary.day, time: primary.time,
      billed: Math.max(0, adjustedBilled), sessions: Math.max(0, adjustedSessions) };
    const { data: updated, error: pErr } = await supabase.from("patients")
      .update(patch).eq("id", patientId).select().single();
    if (pErr) { setMutating(false); setMutationError(pErr.message); return false; }
    setPatients(prev => prev.map(p => p.id === patientId ? { ...updated, colorIdx: updated.color_idx } : p));

    // 3. Generate new sessions with new schedule at new rate
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

  /* ── PAYMENTS ── */
  async function createPayment({ patientName, amount, method = "Transferencia", date = formatShortDate() }) {
    const parsedAmount = Number(amount);
    if (!patientName || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return false;
    const patient = patients.find(p => p.name === patientName);

    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase.from("payments").insert({
      user_id: userId,
      patient_id: patient?.id || null,
      patient: patientName,
      initials: patient?.initials || getInitials(patientName),
      amount: parsedAmount,
      date,
      method,
      color_idx: patient?.colorIdx || 0,
    }).select().single();
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    if (patient) {
      const newPaid = patient.paid + parsedAmount;
      await supabase.from("patients")
        .update({ paid: newPaid }).eq("id", patient.id);
      setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, paid: newPaid } : p));
    }

    setPayments(prev => [{ ...data, colorIdx: data.color_idx }, ...prev]);
    setMutating(false);
    return true;
  }

  async function deletePayment(paymentId) {
    const payment = payments.find(p => p.id === paymentId);
    setMutating(true);
    setMutationError("");
    const { error } = await supabase.from("payments").delete().eq("id", paymentId);
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setPayments(prev => prev.filter(p => p.id !== paymentId));

    if (payment?.patient_id) {
      const patient = patients.find(p => p.id === payment.patient_id);
      if (patient) {
        const newPaid = Math.max(0, patient.paid - payment.amount);
        await supabase.from("patients")
          .update({ paid: newPaid }).eq("id", patient.id);
        setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, paid: newPaid } : p));
      }
    }
    return true;
  }

  /* ── NOTES ── */
  async function createNote({ patientId, sessionId, title, content }) {
    if (!patientId) return null;
    const { data, error } = await supabase.from("notes").insert({
      user_id: userId, patient_id: patientId,
      session_id: sessionId || null,
      title: title || "", content: content || "",
    }).select().single();
    if (error) return null;
    setNotes(prev => [data, ...prev]);
    return data;
  }

  async function updateNote(id, { title, content }) {
    const { error } = await supabase.from("notes")
      .update({ title, content, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return false;
    setNotes(prev => prev.map(n => n.id === id ? { ...n, title, content, updated_at: new Date().toISOString() } : n));
    return true;
  }

  async function deleteNote(id) {
    const { error } = await supabase.from("notes").delete().eq("id", id);
    if (error) return false;
    setNotes(prev => prev.filter(n => n.id !== id));
    return true;
  }

  // Auto-complete scheduled sessions that started > 1 hour ago
  const enrichedSessions = useMemo(() => {
    const now = new Date();
    return upcomingSessions.map(s => {
      if (s.status !== "scheduled") return s;
      const d = parseShortDate(s.date);
      if (s.time) {
        const [h, m] = s.time.split(":");
        d.setHours(parseInt(h) || 0, parseInt(m) || 0);
      }
      d.setTime(d.getTime() + 60 * 60 * 1000); // 1 hour after start
      if (now >= d) return { ...s, status: "completed" };
      return s;
    });
  }, [upcomingSessions]);

  // Persist auto-completions to DB (fire-and-forget)
  useEffect(() => {
    const toComplete = enrichedSessions.filter((s, i) =>
      s.status === "completed" && upcomingSessions[i]?.status === "scheduled" && s.id === upcomingSessions[i]?.id
    );
    if (toComplete.length > 0) {
      Promise.all(toComplete.map(s =>
        supabase.from("sessions").update({ status: "completed" }).eq("id", s.id)
      )).then(() => {
        setUpcomingSessions(prev => {
          const ids = new Set(toComplete.map(s => s.id));
          return prev.map(s => ids.has(s.id) ? { ...s, status: "completed" } : s);
        });
      });
    }
  }, [enrichedSessions, upcomingSessions]);

  // Compute amountDue: billed (historical) minus future sessions' billing minus paid
  const enrichedPatients = useMemo(() => {
    const now = new Date();
    return patients.map(p => {
      let futureCount = 0;
      enrichedSessions.forEach(s => {
        if (s.patient_id !== p.id) return;
        if (s.status === "cancelled") return;
        const d = parseShortDate(s.date);
        if (s.time) {
          const [h, m] = s.time.split(":");
          d.setHours(parseInt(h) || 0, parseInt(m) || 0);
        }
        if (d > now) futureCount++;
      });
      const pastBilled = p.billed - (futureCount * p.rate);
      return { ...p, amountDue: Math.max(0, pastBilled - p.paid) };
    });
  }, [patients, enrichedSessions]);

  return {
    patients: enrichedPatients, upcomingSessions: enrichedSessions, payments, notes,
    loading, mutating, mutationError, readOnly,
    createPatient, updatePatient, deletePatient,
    createSession, updateSessionStatus, deleteSession, rescheduleSession,
    generateRecurringSessions, applyScheduleChange,
    createPayment, deletePayment,
    createNote, updateNote, deleteNote,
    refresh,
  };
}
