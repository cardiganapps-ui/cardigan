import { supabase } from "../supabaseClient";
import { DAY_ORDER } from "../data/seedData";
import { getInitials } from "../utils/dates";
import { recalcPatientCounters } from "../utils/patients";

export function createPatientActions(userId, patients, setPatients, upcomingSessions, setUpcomingSessions, payments, setPayments, documents, setDocuments, setMutating, setMutationError, { formatShortDate, getRecurringDates }) {

  async function createPatient({ name, parent, rate, phone, email, birthdate, tutorFrequency, schedules, recurring, startDate, endDate, whatsappEnabled, heightCm, goalWeightKg, goalBodyFatPct, goalSkeletalMuscleKg, allergies, medicalConditions, schedulingMode, firstConsult }) {
    if (!name?.trim()) return false;
    if (patients.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
      setMutationError("Ya existe un registro con ese nombre.");
      return false;
    }
    const mode = schedulingMode === "episodic" ? "episodic" : "recurring";
    const sched = schedules?.length ? schedules : [{ day: "Lunes", time: "16:00" }];
    const patientRate = Number(rate) || 0;
    const colorIdx = patients.length % 7;

    // Pre-compute the recurring session rows client-side so the initial
    // patient INSERT can include final `sessions` and `billed` counters.
    // Saves an entire round-trip vs. the previous flow (insert → insert
    // sessions → update counters). Episodic patients get at most one
    // session row (the first consult, if the user filled it in) and
    // never participate in this loop.
    const sessionSeeds = [];
    if (mode === "recurring" && recurring && startDate) {
      for (const s of sched) {
        const dur = Number(s.duration) > 0 ? Number(s.duration) : 60;
        const mod = s.modality || "presencial";
        getRecurringDates(s.day, startDate, endDate).forEach(d =>
          sessionSeeds.push({ day: s.day, time: s.time, duration: dur, modality: mod, date: formatShortDate(d), is_recurring: true })
        );
      }
    } else if (mode === "episodic" && firstConsult?.date) {
      // One-off first consult — same shape as a recurring seed but
      // is_recurring=false so auto-extend never picks it up. day is
      // derived from the date for display consistency with the rest
      // of the calendar (sessions.day is the weekday name). Tagged
      // visit_type='intake' since this is, by definition, the first
      // visit on this patient's record.
      const dur = Number(firstConsult.duration) > 0 ? Number(firstConsult.duration) : 60;
      const mod = firstConsult.modality || "presencial";
      const day = dayNameFromISO(firstConsult.date);
      sessionSeeds.push({
        day,
        time: firstConsult.time || "10:00",
        duration: dur,
        modality: mod,
        date: formatShortDate(new Date(firstConsult.date + "T12:00:00")),
        is_recurring: false,
        visit_type: "intake",
      });
    }
    const seedCount = sessionSeeds.length;
    const seedBilled = patientRate * seedCount;

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
      // Episodic patients have no perpetual slot — leave day/time NULL
      // so the rest of the app reads "no recurring schedule" cleanly.
      day:  mode === "recurring" ? sched[0].day  : null,
      time: mode === "recurring" ? sched[0].time : null,
      color_idx: colorIdx,
      start_date: mode === "recurring" && recurring && startDate ? startDate : null,
      scheduling_mode: mode,
      birthdate: birthdate || null,
      tutor_frequency: tutorFrequency || null,
      // Anthropometric / health-history fields. Set for nutritionist
      // + trainer; null/empty for everyone else (the form doesn't
      // surface them, so the caller passes null/"").
      height_cm: heightCm || null,
      goal_weight_kg: goalWeightKg || null,
      goal_body_fat_pct: goalBodyFatPct || null,
      goal_skeletal_muscle_kg: goalSkeletalMuscleKg || null,
      allergies: allergies || "",
      medical_conditions: medicalConditions || "",
      sessions: seedCount,
      billed: seedBilled,
      whatsapp_enabled: !!whatsappEnabled,
      // Stamp consent at creation only when the toggle was flipped on
      // — gives us a clean audit row tying opt-in to a moment.
      whatsapp_consent_at: whatsappEnabled ? new Date().toISOString() : null,
    }).select().single();
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    const newPatient = { ...data, colorIdx: data.color_idx };
    let updatedPatient = newPatient;

    if (sessionSeeds.length > 0) {
      const allRows = sessionSeeds.map(s => ({
        user_id: userId, patient_id: data.id, patient: name.trim(),
        initials: getInitials(name), time: s.time, day: s.day,
        date: s.date, duration: s.duration, rate: patientRate,
        modality: s.modality, color_idx: colorIdx,
        // Recurring patients seed `is_recurring=true` — auto-extend
        // is allowed to derive future weeks from them. Episodic
        // patients seed at most ONE row, `is_recurring=false`, so
        // auto-extend never picks it up.
        is_recurring: s.is_recurring !== false,
        visit_type: s.visit_type || null,
      }));
      const { data: sessData, error: sessErr } = await supabase.from("sessions").insert(allRows).select();
      if (!sessErr && sessData) {
        // Match the shape produced by mapRows() so a subsequent full
        // refresh doesn't introduce reference churn / duplicate keys.
        setUpcomingSessions(prev => [...prev, ...sessData.map(r => ({ ...r, colorIdx: r.color_idx, modality: r.modality || "presencial" }))]);
        // If the returned row count doesn't match the counters we
        // pre-stamped on the patient, reconcile via recalc.
        if (sessData.length !== seedCount) {
          const fixed = await recalcPatientCounters(data.id);
          if (fixed) updatedPatient = { ...newPatient, ...fixed };
        }
      } else {
        // Session insert failed — roll the counters back on the patient
        // so amountDue doesn't show a phantom balance.
        const fixed = await recalcPatientCounters(data.id);
        if (fixed) updatedPatient = { ...newPatient, ...fixed };
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

/* "2026-05-12" → "Martes". Anchored at noon to dodge timezone edge
   cases on the date boundary. Used when seeding an episodic patient's
   first consult — sessions.day stores the weekday name, so we derive
   it from the picked ISO date instead of asking the form for it. */
function dayNameFromISO(iso) {
  const d = new Date((iso || "").slice(0, 10) + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "Lunes";
  return DAY_ORDER[(d.getDay() + 6) % 7]; // Sun=0 → 6 → Sunday last
}
