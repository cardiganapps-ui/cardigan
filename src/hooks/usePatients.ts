import type { Dispatch, SetStateAction } from "react";
import { supabase } from "../supabaseClient";
import { DAY_ORDER } from "../data/seedData";
import { getInitials, shortDateToISO, todayISO } from "../utils/dates";
import { recalcPatientCounters } from "../utils/patients";
import type { TablesInsert, TablesUpdate } from "../types/db";
import type { Json } from "../types/supabase";
import type { PatientRow, SessionRow, PaymentRow, DocumentRow, GroupMemberRow } from "../types/rows";
import { track } from "../lib/analytics";
import { PATIENT_STATUS, SESSION_TYPE, SESSION_STATUS } from "../data/constants";
import { enqueue, registerHandler, onReplay, removeByTempId, updateByTempId } from "../lib/mutationQueue";

// ── Domain row types ────────────────────────────────────────────────
// The patient actions read/write the shared boundary row types
// (src/types/rows.ts). The factory touches several domains (patients +
// their sessions/payments/documents/group memberships) on create/delete.
type Patient = PatientRow;
type Session = SessionRow;
type Payment = PaymentRow;
type GroupMember = GroupMemberRow;

interface Schedule {
  day: string;
  time: string;
  duration?: number | string | null;
  frequency?: string;
  modality?: string;
}

/** A first-consult / interview slot picked in the UI (ISO date). */
interface ConsultSlot {
  date?: string;
  time?: string;
  duration?: number | string | null;
  modality?: string;
}

/** Pre-computed session row to seed at patient creation/conversion. */
interface SessionSeed {
  day: string;
  time: string;
  duration: number;
  modality: string;
  frequency?: string;
  date: string;
  is_recurring: boolean;
  visit_type?: string | null;
}

type Num = number | string | null | undefined;

type SetPatients = Dispatch<SetStateAction<Patient[]>>;
type SetSessions = Dispatch<SetStateAction<Session[]>>;

/* ── Offline queue support (patient creation + simple field edits) ──
   Adding a patient is the FIRST activation action a new user takes, so
   it must degrade gracefully offline like sessions/payments/expenses
   already do. Scope is deliberately narrow:
     • patients.create — replays the same transactional RPC
       (create_patient_with_sessions), so the patient AND their seeded
       schedule land atomically on drain.
     • patients.update — simple single-row field patches.
   deletePatient / createPotential / discardPotential /
   convertPotentialToActive stay ONLINE-ONLY: they are multi-step flows
   (R2 cleanup, cascades, recalcPatientCounters round-trips) where a
   half-replayed queue entry could leave counters wrong — per the prime
   directive we fail loudly there instead of queueing.

   Known limitation (documented tradeoff): rows created offline that
   REFERENCE a not-yet-drained patient (a manual extra session, a
   payment) carry the temp patient_id and will dead-letter on drain —
   preserved, never lost, but they don't auto-remap. The dominant
   offline flow (create patient + their recurring schedule) is a single
   queued op and unaffected. */

registerHandler("patients.create", async ({ userId, p_patient, p_sessions }: {
  userId: string;
  p_patient: Record<string, unknown>;
  p_sessions: Record<string, unknown>[];
}) => {
  // Idempotency guard for replay-after-partial-success: if the first
  // attempt committed server-side but the response was lost in transit,
  // the entry stays queued and would insert a DUPLICATE patient on the
  // next drain (the sessions inside the RPC are protected by
  // uniq_sessions_patient_date_time, the patient row is not — dupe
  // names are only rejected client-side). Names are unique per user by
  // app invariant, so an existing same-name row means "already landed":
  // return it as the result so the replay listener reconciles normally.
  const name = String(p_patient?.name || "");
  const pattern = name.replace(/[%_]/g, "\\$&");
  const { data: existing } = await supabase.from("patients")
    .select("*").eq("user_id", userId).ilike("name", pattern).limit(1);
  if (existing && existing.length > 0) {
    const { data: sess } = await supabase.from("sessions")
      .select("*").eq("user_id", userId).eq("patient_id", existing[0].id);
    return { data: { patient: existing[0], sessions: sess || [] } };
  }
  return await supabase.rpc("create_patient_with_sessions", {
    p_patient: p_patient as Json,
    p_sessions: p_sessions as Json,
  });
});
registerHandler("patients.update", async ({ id, userId, patch }: { id: string; userId: string; patch: Record<string, unknown> }) => {
  return await supabase.from("patients").update(patch as TablesUpdate<"patients">).eq("id", id).eq("user_id", userId);
});

// Module-level state-setter refs so the once-registered onReplay
// listener writes into the live holders (same pattern as usePayments /
// useSessions / useExpenses).
let _setPatientsRef: SetPatients | null = null;
let _setSessionsRef: SetSessions | null = null;
onReplay((entry, result: { error?: unknown; data?: { patient?: Patient; sessions?: Session[] } } | null) => {
  if (entry.op !== "patients.create") return;
  if (!result || result.error || !result.data?.patient) return;
  const tempId = (entry.optimisticMeta as { tempId?: string } | null)?.tempId;
  if (!tempId || !_setPatientsRef) return;
  const real = { ...result.data.patient, colorIdx: result.data.patient.color_idx } as Patient;
  _setPatientsRef(prev => prev.map(p => p.id === tempId ? real : p));
  if (_setSessionsRef) {
    const realSessions = (result.data.sessions || []).map(r => ({ ...r, colorIdx: r.color_idx, modality: r.modality || "presencial" } as Session));
    // Replace ALL temp sessions seeded under this temp patient with the
    // server truth in one pass — ids and patient_id both swap.
    _setSessionsRef(prev => [...prev.filter(s => s.patient_id !== tempId), ...realSessions]);
  }
});

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

const OFFLINE_ONLY_MSG = "Esta acción requiere conexión a internet. Intenta de nuevo al reconectar.";

type SetPayments = Dispatch<SetStateAction<Payment[]>>;
type SetDocuments = Dispatch<SetStateAction<DocumentRow[]>>;
type SetGroupMembers = Dispatch<SetStateAction<GroupMember[]>>;
type SetFlag = Dispatch<SetStateAction<boolean>>;
type SetError = Dispatch<SetStateAction<string>>;

interface PatientHelpers {
  formatShortDate: (d: Date) => string;
  getRecurringDates: (day: string, start: string, end?: string | null, freq?: string) => Date[];
  setGroupMembers?: SetGroupMembers;
}

export function createPatientActions(
  userId: string,
  patients: Patient[],
  setPatients: SetPatients,
  upcomingSessions: Session[],
  setUpcomingSessions: SetSessions,
  payments: Payment[],
  setPayments: SetPayments | undefined,
  documents: DocumentRow[],
  setDocuments: SetDocuments | undefined,
  setMutating: SetFlag,
  setMutationError: SetError,
  { formatShortDate, getRecurringDates, setGroupMembers }: PatientHelpers,
) {
  // Refresh the module-level refs so the once-registered onReplay
  // listener writes into the live state holders.
  _setPatientsRef = setPatients;
  _setSessionsRef = setUpcomingSessions;

  async function createPatient({ name, parent, rate, phone, email, birthdate, tutorFrequency, schedules, recurring, startDate, endDate, whatsappEnabled, externalFolderUrl, heightCm, goalWeightKg, goalBodyFatPct, goalSkeletalMuscleKg, allergies, medicalConditions, schedulingMode, firstConsult, openingBalance }: {
    name?: string;
    parent?: string;
    rate?: Num;
    phone?: string;
    email?: string;
    birthdate?: string | null;
    tutorFrequency?: string | null;
    schedules?: Schedule[];
    recurring?: boolean;
    startDate?: string;
    endDate?: string;
    whatsappEnabled?: boolean;
    externalFolderUrl?: string | null;
    heightCm?: Num;
    goalWeightKg?: Num;
    goalBodyFatPct?: Num;
    goalSkeletalMuscleKg?: Num;
    allergies?: string;
    medicalConditions?: string;
    schedulingMode?: string;
    firstConsult?: ConsultSlot;
    openingBalance?: Num;
  }) {
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
    const sessionSeeds: SessionSeed[] = [];
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

    // Single transactional RPC (migration 083): the patient row and all of
    // its seed sessions commit together or not at all. Replaces the old
    // insert-patient → insert-sessions → recalc two-step, which could leave
    // an orphan patient if the second insert failed mid-flight. user_id is
    // forced from the JWT server-side; duplicate (patient, date, time)
    // slots are skipped idempotently inside the txn (23505 savepoint).
    const pPatient = {
      name: name.trim(),
      parent: parent?.trim() || "",
      phone: phone?.trim() || "",
      email: email?.trim() || "",
      initials: getInitials(name),
      rate: patientRate,
      // Episodic patients have no perpetual slot — leave day/time NULL.
      day:  mode === "recurring" ? sched[0].day  : null,
      time: mode === "recurring" ? sched[0].time : null,
      color_idx: colorIdx,
      start_date: mode === "recurring" && recurring && startDate ? startDate : null,
      scheduling_mode: mode,
      birthdate: birthdate || null,
      tutor_frequency: tutorFrequency || null,
      // Anthropometric / health-history fields (nutritionist + trainer).
      height_cm: heightCm || null,
      goal_weight_kg: goalWeightKg || null,
      goal_body_fat_pct: goalBodyFatPct || null,
      goal_skeletal_muscle_kg: goalSkeletalMuscleKg || null,
      allergies: allergies || "",
      medical_conditions: medicalConditions || "",
      sessions: seedCount,
      billed: seedBilled,
      // Opening balance (migration 078): signed MXN, a standalone amountDue
      // term — never folded into billed/paid/sessions counters.
      opening_balance: Math.round(Number(openingBalance) || 0),
      whatsapp_enabled: !!whatsappEnabled,
      whatsapp_consent_at: whatsappEnabled ? new Date().toISOString() : null,
      external_folder_url: externalFolderUrl || null,
    };
    const pSessions = sessionSeeds.map(s => ({
      patient: name.trim(), initials: getInitials(name),
      time: s.time, day: s.day, date: s.date,
      duration: s.duration, rate: patientRate,
      modality: s.modality, color_idx: colorIdx,
      // Recurring rows seed is_recurring=true (auto-extend derives future
      // weeks); episodic first-consult rows seed false so it never does.
      is_recurring: s.is_recurring !== false,
      recurrence_frequency: s.frequency || "weekly",
      visit_type: s.visit_type || null,
    }));

    // Offline (or transport failure below): land an optimistic temp
    // patient + temp seed sessions in state and queue the SAME RPC args
    // for drain. One queued op carries the patient and their whole
    // schedule, so the transactional guarantee survives the queue hop.
    // Temp session ids share the patient's temp- prefix so the existing
    // temp-id guards in useSessions treat them as not-yet-drained rows.
    const seedOptimistic = () => {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const patient = {
        ...pPatient, id: tempId, user_id: userId,
        status: PATIENT_STATUS.ACTIVE, paid: 0,
        colorIdx, _optimistic: true,
      } as unknown as Patient;
      const sessions = pSessions.map((s, i) => ({
        ...s, id: `${tempId}-s${i}`, user_id: userId, patient_id: tempId,
        status: SESSION_STATUS.SCHEDULED, session_type: SESSION_TYPE.REGULAR,
        colorIdx, _optimistic: true,
      } as unknown as Session));
      setPatients(prev => [...prev, patient].sort((a, b) => a.name.localeCompare(b.name)));
      if (sessions.length > 0) setUpcomingSessions(prev => [...prev, ...sessions]);
      return tempId;
    };

    if (isOffline()) {
      const tempId = seedOptimistic();
      await enqueue("patients.create", { userId, p_patient: pPatient, p_sessions: pSessions }, { tempId });
      setMutating(false);
      if (patients.length === 0) track("first_patient_created");
      return true;
    }

    let rpcData: unknown, error: { message?: string } | null;
    try {
      ({ data: rpcData, error } = await supabase.rpc("create_patient_with_sessions", {
        p_patient: pPatient,
        p_sessions: pSessions,
      }));
    } catch {
      // Transport failure mid-flight — queue with the temp rows for the
      // replay listener to reconcile on drain.
      const tempId = seedOptimistic();
      await enqueue("patients.create", { userId, p_patient: pPatient, p_sessions: pSessions }, { tempId });
      setMutating(false);
      if (patients.length === 0) track("first_patient_created");
      return true;
    }
    const result = rpcData as unknown as { patient?: Patient; sessions?: Session[] } | null;
    if (error || !result?.patient) {
      setMutating(false);
      setMutationError(error?.message || "No se pudo crear el paciente.");
      return false;
    }

    const newPatient = { ...result.patient, colorIdx: result.patient.color_idx } as Patient;
    // Match mapRows() shape so a later full refresh doesn't churn keys.
    const newSessions = (result.sessions || []).map(r => ({ ...r, colorIdx: r.color_idx, modality: r.modality || "presencial" }));
    if (newSessions.length > 0) {
      setUpcomingSessions(prev => [...prev, ...newSessions]);
    }

    setPatients(prev => [...prev, newPatient].sort((a, b) => a.name.localeCompare(b.name)));
    setMutating(false);
    // Activation funnel: the FIRST patient is the key "aha" milestone.
    // `patients` is the pre-insert closure array, so length 0 means this
    // is the user's first. Fire-and-forget; no PII in the payload.
    if (patients.length === 0) track("first_patient_created");
    return true;
  }

  async function updatePatient(id: string, updates: Record<string, unknown>) {
    if (updates.name) {
      const newName = String(updates.name).trim().toLowerCase();
      const dupe = patients.some(p => p.id !== id && p.name.toLowerCase() === newName);
      if (dupe) { setMutationError("Ya existe un paciente con ese nombre."); return false; }
    }
    setMutating(true);
    setMutationError("");
    const patch: Record<string, unknown> = { ...updates };
    if (patch.name) patch.initials = getInitials(String(patch.name));

    const applyLocal = () => setPatients(prev => prev.map(p => p.id === id
      ? ({ ...p, ...patch, ...(patch.color_idx !== undefined ? { colorIdx: patch.color_idx } : {}) } as Patient)
      : p));

    // Offline-created patient whose insert hasn't drained: patch the
    // queued RPC args in place so the insert lands with the edited
    // values instead of enqueuing a doomed UPDATE on a temp id. A name
    // change also propagates to the queued seed sessions' denormalized
    // patient/initials columns.
    if (typeof id === "string" && id.startsWith("temp-")) {
      applyLocal();
      await updateByTempId(id, (args: { p_patient: Record<string, unknown>; p_sessions?: Record<string, unknown>[] }) => {
        const p_patient = { ...args.p_patient, ...patch };
        const p_sessions = patch.name
          ? (args.p_sessions || []).map(s => ({ ...s, patient: String(patch.name).trim(), initials: getInitials(String(patch.name)) }))
          : args.p_sessions;
        return { ...args, p_patient, p_sessions };
      });
      setMutating(false);
      return true;
    }
    if (isOffline()) {
      applyLocal();
      await enqueue("patients.update", { id, userId, patch });
      setMutating(false);
      return true;
    }
    try {
      const { data, error } = await supabase.from("patients")
        .update(patch as TablesUpdate<"patients">).eq("id", id).eq("user_id", userId).select().single();
      setMutating(false);
      if (error) { setMutationError(error.message); return false; }
      setPatients(prev => prev.map(p => p.id === id ? ({ ...data, colorIdx: data.color_idx } as Patient) : p));
      return true;
    } catch {
      // Transport failure — keep the optimistic patch and queue.
      applyLocal();
      await enqueue("patients.update", { id, userId, patch });
      setMutating(false);
      return true;
    }
  }

  async function deletePatient(id: string) {
    // Offline-created patient whose insert hasn't drained: cancel the
    // queued insert so it never resurrects on reconnect, purge the temp
    // rows locally, done — nothing exists server-side yet.
    if (typeof id === "string" && id.startsWith("temp-")) {
      await removeByTempId(id);
      setPatients(prev => prev.filter(p => p.id !== id));
      setUpcomingSessions(prev => prev.filter(s => s.patient_id !== id));
      return true;
    }
    // Online-only (documented above): R2 cleanup + payment/patient
    // cascades can't replay safely from a queue. Fail loudly.
    if (isOffline()) { setMutationError(OFFLINE_ONLY_MSG); return false; }
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
    // group_members cascades via the patient_id FK on the server; prune
    // local state too so a deleted patient doesn't linger as a ghost in any
    // open group roster until the next refresh.
    setGroupMembers?.(prev => prev.filter(m => m.patient_id !== id));
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
  }: {
    name?: string;
    parent?: string;
    rate?: Num;
    phone?: string;
    email?: string;
    whatsappEnabled?: boolean;
    interview?: ConsultSlot;
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
    // Online-only (see offline-queue note above the handlers).
    if (isOffline()) { setMutationError(OFFLINE_ONLY_MSG); return false; }

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

    const newPatient = { ...patientRow, colorIdx: patientRow.color_idx } as Patient;
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
  async function discardPotential(id: string) {
    // Online-only (see offline-queue note above the handlers).
    if (isOffline()) { setMutationError(OFFLINE_ONLY_MSG); return false; }
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
  async function convertPotentialToActive(id: string, {
    rate, parent, phone, email, birthdate, tutorFrequency,
    schedulingMode, schedules, startDate, endDate,
    heightCm, goalWeightKg, goalBodyFatPct, goalSkeletalMuscleKg,
    allergies, medicalConditions,
    firstConsult, // optional — episodic patients can include the next visit here
  }: {
    rate?: Num;
    parent?: string;
    phone?: string;
    email?: string;
    birthdate?: string | null;
    tutorFrequency?: string | null;
    schedulingMode?: string;
    schedules?: Schedule[];
    startDate?: string;
    endDate?: string;
    heightCm?: Num;
    goalWeightKg?: Num;
    goalBodyFatPct?: Num;
    goalSkeletalMuscleKg?: Num;
    allergies?: string;
    medicalConditions?: string;
    firstConsult?: ConsultSlot;
  }) {
    const patient = patients.find(p => p.id === id);
    if (!patient || patient.status !== PATIENT_STATUS.POTENTIAL) return false;
    // Online-only (see offline-queue note above the handlers).
    if (isOffline()) { setMutationError(OFFLINE_ONLY_MSG); return false; }

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
    const sessionSeeds: SessionSeed[] = [];
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
      .update(patch as TablesUpdate<"patients">).eq("id", id).eq("user_id", userId).select().single();
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
            setPatients(prev => prev.map(p => p.id === id ? ({ ...updated, colorIdx: updated.color_idx, ...fixed } as Patient) : p));
            setMutating(false);
            return true;
          }
        }
      } else {
        const fixed = await recalcPatientCounters(id);
        if (fixed) {
          setPatients(prev => prev.map(p => p.id === id ? ({ ...updated, colorIdx: updated.color_idx, ...fixed } as Patient) : p));
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
      ? ({ ...updated, colorIdx: updated.color_idx } as Patient)
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
function dayNameFromISO(iso: string) {
  const d = new Date((iso || "").slice(0, 10) + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "Lunes";
  return DAY_ORDER[(d.getDay() + 6) % 7]; // Sun=0 → 6 → Sunday last
}
