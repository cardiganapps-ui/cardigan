import { useEffect, useState, useCallback } from "react";
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

export function useCardiganData(user) {
  const userId = user?.id;
  const [patients, setPatients] = useState([]);
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    const [pRes, sRes, pmRes] = await Promise.all([
      supabase.from("patients").select("*").order("name"),
      supabase.from("sessions").select("*").order("created_at"),
      supabase.from("payments").select("*").order("created_at", { ascending: false }),
    ]);

    let pData = mapRows(pRes.data);
    let sData = mapRows(sRes.data);

    // Auto-extend recurring sessions for active patients
    if (userId) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const threshold = new Date(today);
      threshold.setDate(today.getDate() + 28); // extend when < 4 weeks remain
      const extendEnd = toISODate(new Date(today.getTime() + 12 * 7 * 86400000));
      let didExtend = false;

      for (const patient of pData) {
        if (patient.status !== "active") continue;
        const pSess = sData.filter(s => s.patient_id === patient.id && s.status !== "cancelled");
        if (pSess.length === 0) continue;

        // Infer schedules from existing sessions
        const schedMap = new Map();
        pSess.forEach(s => schedMap.set(`${s.day}|${s.time}`, { day: s.day, time: s.time }));

        // Find latest session date
        const existingDates = new Set(pSess.map(s => s.date));
        let latest = null;
        pSess.forEach(s => {
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
    setLoading(false);
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  /* ── PATIENTS ── */
  async function createPatient({ name, parent, rate, schedules, recurring, startDate, endDate }) {
    if (!name?.trim()) return false;
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
  async function createSession({ patientName, date, time }) {
    if (!patientName?.trim() || !date?.trim() || !time?.trim()) return false;
    const patient = patients.find(p => p.name === patientName);
    if (!patient) return false;

    const [dayNum, monthStr] = date.split(" ");
    const monthIdx = SHORT_MONTHS.indexOf(monthStr);
    const year = new Date().getFullYear();
    const dateObj = new Date(year, monthIdx >= 0 ? monthIdx : 0, parseInt(dayNum) || 1);
    const dayName = DAY_ORDER[(dateObj.getDay() + 6) % 7];

    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase.from("sessions").insert({
      user_id: userId,
      patient_id: patient.id,
      patient: patientName.trim(),
      initials: patient.initials,
      time: time.trim(),
      day: dayName,
      date: date.trim(),
      color_idx: patient.colorIdx || 0,
    }).select().single();
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    // Update patient's session count and billed amount
    const newSessions = patient.sessions + 1;
    const newBilled = patient.billed + patient.rate;
    await supabase.from("patients")
      .update({ sessions: newSessions, billed: newBilled })
      .eq("id", patient.id);

    setUpcomingSessions(prev => [...prev, { ...data, colorIdx: data.color_idx }]);
    setPatients(prev => prev.map(p => p.id === patient.id
      ? { ...p, sessions: newSessions, billed: newBilled } : p));
    setMutating(false);
    return true;
  }

  async function updateSessionStatus(sessionId, status) {
    setMutating(true);
    setMutationError("");
    const { error } = await supabase.from("sessions")
      .update({ status }).eq("id", sessionId);
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setUpcomingSessions(prev => prev.map(s => s.id === sessionId ? { ...s, status } : s));
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

  return {
    patients, upcomingSessions, payments, loading, mutating, mutationError,
    createPatient, updatePatient, deletePatient,
    createSession, updateSessionStatus, deleteSession, generateRecurringSessions,
    createPayment, deletePayment,
    refresh,
  };
}
