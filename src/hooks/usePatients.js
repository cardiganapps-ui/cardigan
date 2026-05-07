import { supabase } from "../supabaseClient";
import { DAY_ORDER } from "../data/seedData";
import { getInitials, shortDateToISO, todayISO } from "../utils/dates";
import { recalcPatientCounters } from "../utils/patients";
import { PATIENT_STATUS, SESSION_TYPE, SESSION_STATUS } from "../data/constants";

export function createPatientActions(userId, patients, setPatients, upcomingSessions, setUpcomingSessions, payments, setPayments, documents, setDocuments, setMutating, setMutationError, { formatShortDate, getRecurringDates }) {

  async function createPatient({ name, parent, rate, phone, email, birthdate, tutorFrequency, schedules, recurring, startDate, endDate, whatsappEnabled, externalFolderUrl, heightCm, goalWeightKg, goalBodyFatPct, goalSkeletalMuscleKg, allergies, medicalConditions, schedulingMode, firstConsult }) {
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
        const freq = s.frequency || "weekly";
        getRecurringDates(s.day, startDate, endDate, freq).forEach(d =>
          sessionSeeds.push({ day: s.day, time: s.time, duration: dur, modality: mod, frequency: freq, date: formatShortDate(d), is_recurring: true })
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
      // Optional cloud-folder link. Stored as null when blank so the
      // empty-state branch in ExternalFolderCard renders cleanly.
      external_folder_url: externalFolderUrl || null,
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
        // Stamp recurrence_frequency on every recurring row so
        // auto-extend can read the slot's stride later. Episodic
        // first-consult rows pass through with the DB default
        // ('weekly') — harmless because is_recurring=false keeps
        // them out of the schedule-derivation path entirely.
        recurrence_frequency: s.frequency || "weekly",
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

  /* ── Interview-stage flows (migration 047) ────────────────────────
     Three coordinated mutations so the Potenciales surface stays
     correct end-to-end:

       createPotential — inserts a slim patient row (status='potential',
                          scheduling_mode='episodic') AND a single
                          interview session (session_type='interview',
                          is_recurring=false). billed and sessions are
                          stamped at insert time so the row is
                          accounting-correct from the moment the form
                          submits — no second round-trip needed.

       discardPotential — soft-archive. Flips the patient to 'discarded'
                          and marks any still-scheduled interview as
                          cancelled (with cancel_reason set so the row
                          is auditable). Cancelling the interview row
                          drops it from /api/calendar (which selects
                          status IN scheduled/completed) and from the
                          send-session-reminders cron, no separate fix
                          needed.

       convertPotentialToActive — promotes a potential to a real
                          patient in place. We update (not insert) so
                          payments / notes / documents / the interview
                          session itself stay linked via patient_id.
                          The interview's `rate` column is intentionally
                          left untouched: per the prime directive,
                          per-session rate preserves historical
                          accuracy across rate changes. */

  // Insert a potential + their single interview session in two
  // sequential queries (patient first to mint id, then the session).
  // Optimistic local-state updates mirror createPatient's pattern.
  async function createPotential({
    name, parent, rate, phone, email, whatsappEnabled,
    interview, // { date, time, duration, modality } — required
  }) {
    if (!name?.trim()) return false;
    // Dedupe only against active + potential — discarded names can be
    // re-used (someone returns months later).
    const dupe = patients.some(p =>
      (p.status === PATIENT_STATUS.ACTIVE || p.status === PATIENT_STATUS.POTENTIAL)
      && p.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (dupe) {
      setMutationError("Ya existe un registro con ese nombre.");
      return false;
    }
    if (!interview?.date || !interview?.time) return false;

    const patientRate = Math.max(0, Number(rate) || 0);
    const colorIdx = patients.length % 7;
    const dur = Number(interview.duration) > 0 ? Number(interview.duration) : 60;
    const modality = interview.modality || "presencial";
    const day = dayNameFromISO(interview.date);
    const sessionDate = formatShortDate(new Date(interview.date + "T12:00:00"));

    setMutating(true);
    setMutationError("");
    const { data: patientRow, error } = await supabase.from("patients").insert({
      user_id: userId,
      name: name.trim(),
      parent: parent?.trim() || "",
      phone: phone?.trim() || "",
      email: email?.trim() || "",
      initials: getInitials(name),
      rate: patientRate,
      // Episodic + null day/time so the rest of the app reads
      // "no perpetual slot" cleanly. Conversion fills these in.
      day: null,
      time: null,
      color_idx: colorIdx,
      // start_date is intentionally null at potential-stage — the
      // engagement hasn't started yet. Conversion stamps today.
      start_date: null,
      scheduling_mode: "episodic",
      status: PATIENT_STATUS.POTENTIAL,
      // sessions=1, billed=rate so amountDue reflects the interview
      // tariff immediately. recalcPatientCounters reconciles if the
      // session insert fails.
      sessions: 1,
      billed: patientRate,
      whatsapp_enabled: !!whatsappEnabled,
      whatsapp_consent_at: whatsappEnabled ? new Date().toISOString() : null,
    }).select().single();
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    const newPatient = { ...patientRow, colorIdx: patientRow.color_idx };
    let updatedPatient = newPatient;

    const { data: sessRow, error: sessErr } = await supabase.from("sessions").insert({
      user_id: userId,
      patient_id: patientRow.id,
      patient: name.trim(),
      initials: getInitials(name),
      time: interview.time,
      day,
      date: sessionDate,
      duration: dur,
      rate: patientRate,
      modality,
      session_type: SESSION_TYPE.INTERVIEW,
      // Critical: interview rows are one-offs forever. Even after
      // conversion, computeAutoExtendRows must never derive a
      // recurring slot from this row. The defensive
      // isInterviewSession() filter in recurrence.js is a second
      // line of defense; this is the primary.
      is_recurring: false,
      visit_type: null,
      color_idx: colorIdx,
    }).select().single();

    if (!sessErr && sessRow) {
      setUpcomingSessions(prev => [...prev, { ...sessRow, colorIdx: sessRow.color_idx, modality: sessRow.modality || "presencial" }]);
    } else {
      // Session insert failed — bring patient counters back in line
      // with truth so amountDue doesn't show a phantom interview.
      const fixed = await recalcPatientCounters(patientRow.id);
      if (fixed) updatedPatient = { ...newPatient, ...fixed };
    }

    setPatients(prev => [...prev, updatedPatient].sort((a, b) => a.name.localeCompare(b.name)));
    setMutating(false);
    return true;
  }

  // Soft-archive ("cold storage"). Flip the patient to 'discarded'
  // and cancel ONLY interviews that haven't happened yet. A past
  // scheduled interview has — by the prime directive's auto-complete
  // rule — visually rendered as "completed" since the slot passed,
  // and the consultation actually took place; cancelling it would
  // erase a real event from the patient's history. We narrow the
  // cancel to (status='scheduled' AND date >= today AND session_type
  // ='interview'), matching the user's mental model: "they came in,
  // we decided not to engage, file them away."
  async function discardPotential(id) {
    setMutating(true);
    setMutationError("");
    const { error } = await supabase.from("patients")
      .update({ status: PATIENT_STATUS.DISCARDED })
      .eq("id", id).eq("user_id", userId);
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    // Find scheduled interview rows for this patient via local state,
    // then filter to FUTURE only. Doing the date math client-side
    // sidesteps the "D-MMM" date format which doesn't sort
    // lexicographically through Postgres.
    const today = todayISO();
    const futureScheduledInterviewIds = (upcomingSessions || [])
      .filter(s =>
        s.patient_id === id
        && s.session_type === SESSION_TYPE.INTERVIEW
        && s.status === SESSION_STATUS.SCHEDULED
        && shortDateToISO(s.date) >= today
      )
      .map(s => s.id);

    if (futureScheduledInterviewIds.length > 0) {
      // i18n string lives in es.js (sessions.discardReason) so the
      // value here is the English-style audit constant — therapists
      // never see it raw, only the translated string surfaced when
      // listing cancelled sessions.
      const { error: sErr } = await supabase.from("sessions")
        .update({ status: SESSION_STATUS.CANCELLED, cancel_reason: "Potencial archivado" })
        .eq("user_id", userId)
        .in("id", futureScheduledInterviewIds);
      if (sErr) { setMutating(false); setMutationError(sErr.message); return false; }

      setUpcomingSessions(prev => prev.map(s =>
        futureScheduledInterviewIds.includes(s.id)
          ? { ...s, status: SESSION_STATUS.CANCELLED, cancel_reason: "Potencial archivado" }
          : s
      ));
    }

    setMutating(false);

    // recalcPatientCounters keeps billed/paid/sessions in sync with
    // the new truth. Past completed interviews continue to count
    // toward billed (the consultation actually happened); only the
    // newly-cancelled future rows drop out.
    const fixed = await recalcPatientCounters(id);
    setPatients(prev => prev.map(p => p.id === id
      ? { ...p, status: PATIENT_STATUS.DISCARDED, ...(fixed || {}) }
      : p
    ));
    return true;
  }

  // Promote a potential to active in place. Updates the existing row
  // (patient_id continuity preserves payments / notes / documents /
  // the interview session itself), then seeds the new schedule.
  // Counters are INCREMENTED (not overwritten) so the interview's
  // contribution stays in billed/sessions.
  async function convertPotentialToActive(id, {
    rate, parent, phone, email, birthdate, tutorFrequency,
    schedulingMode, schedules, startDate, endDate,
    heightCm, goalWeightKg, goalBodyFatPct, goalSkeletalMuscleKg,
    allergies, medicalConditions,
    firstConsult, // optional — episodic patients can include the next visit here
  }) {
    const patient = patients.find(p => p.id === id);
    if (!patient || patient.status !== PATIENT_STATUS.POTENTIAL) return false;

    const mode = schedulingMode === "episodic" ? "episodic" : "recurring";
    const sched = schedules?.length ? schedules : [{ day: "Lunes", time: "16:00" }];
    const newRate = Math.max(0, Number(rate) || 0);
    // Pick a fresh slot in the active-patient color rotation.
    const activeCount = patients.filter(p => p.status === PATIENT_STATUS.ACTIVE).length;
    const newColorIdx = activeCount % 7;

    // Pre-compute the new session seeds so we can stamp final counters
    // on the patient UPDATE in one round-trip.
    //
    // Critical dedup: the existing interview session occupies a
    // (date, time) slot and the DB unique index
    // uniq_sessions_patient_date_time treats (patient_id, date, time)
    // as the conflict key — session_type doesn't disambiguate. So a
    // recurring schedule whose startDate falls on the interview's
    // day/time would 23505 on insert, partially-fail the conversion
    // (patient flipped to active, no recurring rows landed), and
    // recalcPatientCounters would silently swallow the mismatch.
    // Skipping the colliding seed lets the conversion succeed and
    // preserves the interview session intact at its original rate.
    const existingSlots = new Set(
      (upcomingSessions || [])
        .filter(s => s.patient_id === id)
        .map(s => `${s.date}|${s.time}`)
    );
    const sessionSeeds = [];
    if (mode === "recurring" && startDate) {
      for (const s of sched) {
        const dur = Number(s.duration) > 0 ? Number(s.duration) : 60;
        const mod = s.modality || "presencial";
        const freq = s.frequency || "weekly";
        getRecurringDates(s.day, startDate, endDate, freq).forEach(d => {
          const date = formatShortDate(d);
          const slot = `${date}|${s.time}`;
          if (existingSlots.has(slot)) return;
          existingSlots.add(slot);
          sessionSeeds.push({ day: s.day, time: s.time, duration: dur, modality: mod, frequency: freq, date, is_recurring: true });
        });
      }
    } else if (mode === "episodic" && firstConsult?.date) {
      const dur = Number(firstConsult.duration) > 0 ? Number(firstConsult.duration) : 60;
      const mod = firstConsult.modality || "presencial";
      const day = dayNameFromISO(firstConsult.date);
      const date = formatShortDate(new Date(firstConsult.date + "T12:00:00"));
      const time = firstConsult.time || "10:00";
      const slot = `${date}|${time}`;
      // Same dedup safeguard for the episodic first-consult — if the
      // practitioner picks the same date/time as the interview (e.g.
      // the interview itself is being repurposed as the intake), skip.
      if (!existingSlots.has(slot)) {
        existingSlots.add(slot);
        sessionSeeds.push({
          day,
          time,
          duration: dur,
          modality: mod,
          date,
          is_recurring: false,
          visit_type: "intake",
        });
      }
    }
    const seedCount = sessionSeeds.length;

    setMutating(true);
    setMutationError("");

    const todayISO = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    })();

    const patch = {
      status: PATIENT_STATUS.ACTIVE,
      scheduling_mode: mode,
      day:  mode === "recurring" ? sched[0].day  : null,
      time: mode === "recurring" ? sched[0].time : null,
      // start_date stamps the conversion moment — that's when the
      // engagement actually starts. The interview lives in the past
      // sessions list; start_date is for "first day under this
      // engagement" which everywhere else in the app means active.
      start_date: mode === "recurring" && startDate ? startDate : todayISO,
      rate: newRate,
      parent: parent?.trim() ?? patient.parent ?? "",
      phone: phone?.trim() ?? patient.phone ?? "",
      email: email?.trim() ?? patient.email ?? "",
      birthdate: birthdate || patient.birthdate || null,
      tutor_frequency: tutorFrequency || null,
      // Per-profession nutritionist/trainer fields. Caller passes
      // null for professions that don't surface them.
      height_cm: heightCm || null,
      goal_weight_kg: goalWeightKg || null,
      goal_body_fat_pct: goalBodyFatPct || null,
      goal_skeletal_muscle_kg: goalSkeletalMuscleKg || null,
      allergies: allergies || patient.allergies || "",
      medical_conditions: medicalConditions || patient.medical_conditions || "",
      // Counters: ADD the new session count + their billed total.
      // Interview's contribution stays untouched.
      sessions: (patient.sessions || 0) + seedCount,
      billed:   (patient.billed   || 0) + newRate * seedCount,
      color_idx: newColorIdx,
    };

    const { data: updated, error } = await supabase.from("patients")
      .update(patch).eq("id", id).eq("user_id", userId).select().single();
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    // Insert the new session rows.
    if (sessionSeeds.length > 0) {
      const allRows = sessionSeeds.map(s => ({
        user_id: userId, patient_id: id, patient: updated.name,
        initials: updated.initials, time: s.time, day: s.day,
        date: s.date, duration: s.duration, rate: newRate,
        modality: s.modality, color_idx: newColorIdx,
        is_recurring: s.is_recurring !== false,
        recurrence_frequency: s.frequency || "weekly",
        visit_type: s.visit_type || null,
        session_type: SESSION_TYPE.REGULAR,
      }));
      const { data: sessData, error: sessErr } = await supabase.from("sessions").insert(allRows).select();
      if (!sessErr && sessData) {
        setUpcomingSessions(prev => [...prev, ...sessData.map(r => ({ ...r, colorIdx: r.color_idx, modality: r.modality || "presencial" }))]);
        if (sessData.length !== seedCount) {
          const fixed = await recalcPatientCounters(id);
          if (fixed) {
            setPatients(prev => prev.map(p => p.id === id ? { ...updated, colorIdx: updated.color_idx, ...fixed } : p));
            setMutating(false);
            return true;
          }
        }
      } else {
        const fixed = await recalcPatientCounters(id);
        if (fixed) {
          setPatients(prev => prev.map(p => p.id === id ? { ...updated, colorIdx: updated.color_idx, ...fixed } : p));
          setMutating(false);
          return true;
        }
      }
    }

    // Bump the interview session's color so it renders alongside the
    // active patient's other sessions cleanly. The session_type stays
    // 'interview' (and rose-rail) so it's still distinguishable in
    // the patient's history; only the avatar color updates.
    await supabase.from("sessions")
      .update({ color_idx: newColorIdx })
      .eq("user_id", userId)
      .eq("patient_id", id)
      .eq("session_type", SESSION_TYPE.INTERVIEW);
    setUpcomingSessions(prev => prev.map(s =>
      s.patient_id === id && s.session_type === SESSION_TYPE.INTERVIEW
        ? { ...s, color_idx: newColorIdx, colorIdx: newColorIdx }
        : s
    ));

    setPatients(prev => prev.map(p => p.id === id
      ? { ...updated, colorIdx: updated.color_idx }
      : p
    ));
    setMutating(false);
    return true;
  }

  return { createPatient, updatePatient, deletePatient, createPotential, discardPotential, convertPotentialToActive };
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
