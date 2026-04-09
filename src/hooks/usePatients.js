import { supabase } from "../supabaseClient";
import { DAY_ORDER } from "../data/seedData";
import { getInitials } from "../utils/dates";

export function createPatientActions(userId, patients, setPatients, upcomingSessions, setUpcomingSessions, setMutating, setMutationError, { formatShortDate, getRecurringDates }) {

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

  return { createPatient, updatePatient, deletePatient };
}
