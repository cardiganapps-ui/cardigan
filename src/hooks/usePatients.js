import { supabase } from "../supabaseClient";
import { DAY_ORDER } from "../data/seedData";
import { getInitials } from "../utils/dates";
import { recalcPatientCounters } from "../utils/patients";

export function createPatientActions(userId, patients, setPatients, upcomingSessions, setUpcomingSessions, payments, setPayments, documents, setDocuments, setMutating, setMutationError, { formatShortDate, getRecurringDates }) {

  async function createPatient({ name, parent, rate, phone, email, birthdate, tutorFrequency, schedules, recurring, startDate, endDate }) {
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
      phone: phone?.trim() || "",
      email: email?.trim() || "",
      initials: getInitials(name),
      rate: patientRate,
      day: sched[0].day,
      time: sched[0].time,
      color_idx: colorIdx,
      start_date: recurring && startDate ? startDate : null,
      birthdate: birthdate || null,
      tutor_frequency: tutorFrequency || null,
    }).select().single();
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    const newPatient = { ...data, colorIdx: data.color_idx };
    let updatedPatient = newPatient;

    if (recurring && startDate) {
      const allRows = [];
      for (const s of sched) {
        const dur = Number(s.duration) > 0 ? Number(s.duration) : 60;
        getRecurringDates(s.day, startDate, endDate).forEach(d =>
          allRows.push({ user_id: userId, patient_id: data.id, patient: name.trim(),
            initials: getInitials(name), time: s.time, day: s.day,
            date: formatShortDate(d), duration: dur, rate: patientRate, color_idx: colorIdx }));
      }
      if (allRows.length > 0) {
        const { data: sessData, error: sessErr } = await supabase.from("sessions").insert(allRows).select();
        if (!sessErr && sessData) {
          const n = sessData.length;
          const billed = patientRate * n;
          const { error: pErr } = await supabase.from("patients").update({ sessions: n, billed }).eq("id", data.id).eq("user_id", userId);
          if (pErr) {
            const fixed = await recalcPatientCounters(data.id);
            if (fixed) updatedPatient = { ...newPatient, ...fixed };
          } else {
            updatedPatient = { ...newPatient, sessions: n, billed };
          }
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
      .update(patch).eq("id", id).eq("user_id", userId).select().single();
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setPatients(prev => prev.map(p => p.id === id ? { ...data, colorIdx: data.color_idx } : p));
    return true;
  }

  async function deletePatient(id) {
    setMutating(true);
    setMutationError("");

    // 1. Clean up R2 storage files for this patient's documents. The
    //    document metadata rows cascade via FK, but the binary files in
    //    storage would leak otherwise. Failures here are non-fatal — we
    //    still proceed with the DB deletes so the user isn't blocked by
    //    transient storage errors.
    const patientDocs = (documents || []).filter(d => d.patient_id === id);
    if (patientDocs.length > 0) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = {
          "Authorization": `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        };
        await Promise.all(patientDocs.map(d =>
          fetch("/api/delete-document", {
            method: "POST", headers,
            body: JSON.stringify({ path: d.file_path }),
          }).catch(() => {})
        ));
      } catch { /* noop — don't block patient delete on storage errors */ }
    }

    // 2. Payments use ON DELETE SET NULL, so we must delete them
    //    explicitly or they'd be left orphaned. Everything else
    //    (sessions, notes, documents metadata) cascades via FK.
    const { error: payErr } = await supabase.from("payments")
      .delete().eq("patient_id", id).eq("user_id", userId);
    if (payErr) { setMutating(false); setMutationError(payErr.message); return false; }

    // 3. Delete the patient row — cascades remove sessions, notes, docs.
    const { error } = await supabase.from("patients").delete().eq("id", id).eq("user_id", userId);
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }

    // 4. Sync local state with what the DB now reflects.
    setPatients(prev => prev.filter(p => p.id !== id));
    setUpcomingSessions(prev => prev.filter(s => s.patient_id !== id));
    setPayments?.(prev => prev.filter(p => p.patient_id !== id));
    setDocuments?.(prev => prev.filter(d => d.patient_id !== id));
    return true;
  }

  return { createPatient, updatePatient, deletePatient };
}
