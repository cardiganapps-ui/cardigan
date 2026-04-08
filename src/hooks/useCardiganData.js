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

function getUpcomingDates(dayName, weeks) {
  const target = DAY_TO_JS[dayName];
  if (target == null || weeks <= 0) return [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let diff = target - today.getDay();
  if (diff <= 0) diff += 7;
  const dates = [];
  for (let i = 0; i < weeks; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + diff + i * 7);
    dates.push(d);
  }
  return dates;
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
    setPatients(mapRows(pRes.data));
    setUpcomingSessions(mapRows(sRes.data));
    setPayments(mapRows(pmRes.data));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /* ── PATIENTS ── */
  async function createPatient({ name, parent, rate, day, time, recurringWeeks }) {
    if (!name?.trim()) return false;
    setMutating(true);
    setMutationError("");
    const patientDay = day || "Lunes";
    const patientTime = time || "16:00";
    const patientRate = Number(rate) || 700;
    const colorIdx = patients.length % 7;
    const { data, error } = await supabase.from("patients").insert({
      user_id: userId,
      name: name.trim(),
      parent: parent?.trim() || "",
      initials: getInitials(name),
      rate: patientRate,
      day: patientDay,
      time: patientTime,
      color_idx: colorIdx,
    }).select().single();
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    const newPatient = { ...data, colorIdx: data.color_idx };
    let updatedPatient = newPatient;

    // Generate recurring sessions if requested
    const weeks = Number(recurringWeeks) || 0;
    if (weeks > 0) {
      const dates = getUpcomingDates(patientDay, weeks);
      const rows = dates.map(d => ({
        user_id: userId,
        patient_id: data.id,
        patient: name.trim(),
        initials: getInitials(name),
        time: patientTime,
        day: patientDay,
        date: formatShortDate(d),
        color_idx: colorIdx,
      }));
      const { data: sessData, error: sessErr } = await supabase.from("sessions").insert(rows).select();
      if (!sessErr && sessData) {
        const newSessions = sessData.length;
        const newBilled = patientRate * newSessions;
        await supabase.from("patients")
          .update({ sessions: newSessions, billed: newBilled })
          .eq("id", data.id);
        updatedPatient = { ...newPatient, sessions: newSessions, billed: newBilled };
        setUpcomingSessions(prev => [...prev, ...sessData.map(r => ({ ...r, colorIdx: r.color_idx }))]);
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

  async function generateRecurringSessions(patientId, weeks) {
    const patient = patients.find(p => p.id === patientId);
    if (!patient || weeks <= 0) return false;
    const dates = getUpcomingDates(patient.day, weeks);
    if (dates.length === 0) return false;

    setMutating(true);
    setMutationError("");
    const rows = dates.map(d => ({
      user_id: userId,
      patient_id: patient.id,
      patient: patient.name,
      initials: patient.initials,
      time: patient.time,
      day: patient.day,
      date: formatShortDate(d),
      color_idx: patient.colorIdx || 0,
    }));
    const { data, error } = await supabase.from("sessions").insert(rows).select();
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
