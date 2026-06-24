/* ── Patient edit-form state + save orchestration (WS-6) ──────────────
   Patients.tsx carried ~17 `edit*` state fields, three byte-identical
   "populate the form from a patient row" blocks, and the `saveEdit`
   branch machine (finalize / schedule-or-rate change / basic info) inline
   — ~150 lines woven through the screen. This hook owns all of it so the
   screen body is just `const { … } = usePatientEditForm({ … })` + JSX.

   Prime Directive note: `saveEdit` is a money-write path (it changes rate,
   opening balance, and — via applyScheduleChange — regenerates sessions).
   The branch SELECTION (which mutation runs, with which payload) lives here
   and is unit-tested directly (`usePatientEditForm.test.ts`), since the
   patient edit/save flow has no e2e coverage. The payload itself is built
   by the already-tested `buildPatientEditPayload`. */

import { useState } from "react";
import { haptic } from "../../utils/haptics";
import { todayISO } from "../../utils/dates";
import { formatPhoneMX } from "../../utils/contact";
import { isEpisodic, DEFAULT_RECURRENCE_FREQUENCY } from "../../data/constants";
import { signedOpeningBalance } from "../../utils/openingBalance";
import { buildPatientEditPayload } from "../../utils/patientEditPayload";

// The patient/session rows are the loosely-typed UI shape from context
// (schedule objects carry day/time/duration/modality/frequency, plus the
// optional opening_balance / whatsapp_* columns). This is the same
// pure-UI `Row = any` plumbing Patients.tsx uses — outside WS-4's typed
// data-boundary scope.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

/* Read the recurrence frequency of a patient's slot from the most
   recent scheduled session that's part of the recurring schedule.
   Every session in a recurring slot carries the same value (set
   at create / applyScheduleChange time). Pre-migration-044 rows
   have 'weekly' via the column default, so existing patients show
   "Semanal" in the edit form — no behavioral change for them. */
export function deriveSlotFrequency(p: Row, sessions: Row[]) {
  if (!p?.day || !p?.time) return DEFAULT_RECURRENCE_FREQUENCY;
  const future = (sessions || []).filter((s: Row) =>
    s.patient_id === p.id
    && s.day === p.day
    && s.time === p.time
    && s.is_recurring !== false
    && s.recurrence_frequency
  );
  if (future.length === 0) return DEFAULT_RECURRENCE_FREQUENCY;
  return future[0].recurrence_frequency || DEFAULT_RECURRENCE_FREQUENCY;
}

export interface UsePatientEditFormDeps {
  /** The patient currently open in the detail/edit sheet. */
  selected: Row | null;
  upcomingSessions: Row[];
  updatePatient: (id: string, updates: Record<string, unknown>) => Promise<boolean>;
  finalizePatient: (id: string, date: string) => Promise<boolean>;
  applyScheduleChange: (
    id: string,
    opts: { schedules: Row[]; rate: number; effectiveDate: string; endDate?: string },
  ) => Promise<boolean>;
  // Sheet-mode flags owned by Patients.tsx — populate/save toggle them.
  setSelected: (p: Row | null) => void;
  setEditing: (v: boolean) => void;
  setConfirmDelete: (v: boolean) => void;
}

export function usePatientEditForm(deps: UsePatientEditFormDeps) {
  const {
    selected, upcomingSessions,
    updatePatient, finalizePatient, applyScheduleChange,
    setSelected, setEditing, setConfirmDelete,
  } = deps;

  const [editName, setEditName]       = useState("");
  const [editIsMinor, setEditIsMinor] = useState(false);
  const [editParent, setEditParent]   = useState("");
  const [editRate, setEditRate]       = useState("");
  // Opening balance edit (migration 078). Amount is always positive in
  // the field; direction picks debt vs. credit and signs it on save.
  const [editOpeningAmount, setEditOpeningAmount] = useState("");
  const [editOpeningDir, setEditOpeningDir] = useState("owes"); // 'owes' | 'credit'
  const [editTutorFrequency, setEditTutorFrequency] = useState("");
  const [editPhone, setEditPhone]     = useState("");
  const [editEmail, setEditEmail]     = useState("");
  const [editWhatsappEnabled, setEditWhatsappEnabled] = useState(false);
  const [editWhatsappConsentAt, setEditWhatsappConsentAt] = useState<string | null>(null);
  const [editBirthdate, setEditBirthdate] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editStatus, setEditStatus]   = useState("");
  const [editSchedules, setEditSchedules] = useState<Row[]>([{ day: "Lunes", time: "16:00", modality: "presencial", frequency: DEFAULT_RECURRENCE_FREQUENCY }]);
  const [effectiveDate, setEffectiveDate] = useState(todayISO());
  const [hasEndDate, setHasEndDate]       = useState(false);
  const [endDate, setEndDate]             = useState("");
  const [finishDate, setFinishDate]       = useState(todayISO());
  // Track originals to detect changes
  const [origRate, setOrigRate]           = useState(0);
  const [origSchedules, setOrigSchedules] = useState("[]");

  // Populate the edit form from a patient row + open the sheet in edit
  // mode. Three call sites used to inline this verbatim; they all route
  // here now so the form can't drift between entry points.
  const openEditForPatient = (p: Row, opts: { confirmDelete?: boolean } = {}) => {
    // Episodic patients have no perpetual day/time; reading p.day / p.time
    // for them produces (null, null) which would render as empty selects
    // and, on save, trigger applyScheduleChange with bogus values that
    // flip the patient to a recurring slot the practitioner never picked.
    // Seed a sane placeholder ONLY for the form's internal state shape;
    // the schedule UI is hidden for episodic patients (see render gate),
    // and the save path skips applyScheduleChange entirely.
    const slotFreq = deriveSlotFrequency(p, upcomingSessions);
    const scheds = isEpisodic(p)
      ? [{ day: "Lunes", time: "16:00", frequency: DEFAULT_RECURRENCE_FREQUENCY }]
      : [{ day: p.day, time: p.time, frequency: slotFreq }];
    setEditName(p.name);
    setEditIsMinor(!!p.parent);
    setEditParent(p.parent || "");
    setEditRate(String(p.rate));
    setEditOpeningAmount(p.opening_balance ? String(Math.abs(p.opening_balance)) : "");
    setEditOpeningDir((p.opening_balance || 0) < 0 ? "credit" : "owes");
    setEditPhone(formatPhoneMX(p.phone));
    setEditEmail(p.email || "");
    setEditWhatsappEnabled(!!p.whatsapp_enabled);
    setEditWhatsappConsentAt(p.whatsapp_consent_at || null);
    setEditBirthdate(p.birthdate || "");
    setEditStartDate(p.start_date || "");
    setEditStatus(p.status);
    setEditSchedules(scheds);
    setOrigRate(p.rate);
    setOrigSchedules(JSON.stringify(scheds));
    setEffectiveDate(todayISO());
    setHasEndDate(false);
    setEndDate("");
    setSelected(p);
    setEditing(true);
    setConfirmDelete(!!opts.confirmDelete);
  };

  const updateEditSched = (i: number, f: string, v: Row) =>
    setEditSchedules((prev: Row[]) => prev.map((s: Row, idx: number) => idx === i ? { ...s, [f]: v } : s));

  const scheduleOrRateChanged = () => {
    const rateChanged = Number(editRate) !== origRate;
    const schedChanged = JSON.stringify(editSchedules) !== origSchedules;
    return rateChanged || schedChanged;
  };

  const isFinalizingPatient = editStatus === "ended" && selected?.status === "active";

  const saveEdit = async () => {
    if (!selected) return;
    // Signed opening balance for every save path (positive = owes, negative
    // = saldo a favor, 0 = none / cleared). Shared money rule — see helper.
    const editOpeningBalance = signedOpeningBalance(editOpeningAmount, editOpeningDir);
    // The updatePatient payload is the same across all three save branches
    // (differing only in status/rate) — built via buildPatientEditPayload so
    // the WhatsApp-consent + contact rules live in one tested place.
    const nowIso = new Date().toISOString();
    const editForm = {
      name: editName, isMinor: editIsMinor, parent: editParent, tutorFrequency: editTutorFrequency,
      phone: editPhone, email: editEmail, birthdate: editBirthdate, startDate: editStartDate,
      status: editStatus, rate: editRate, openingBalance: editOpeningBalance,
      whatsappEnabled: editWhatsappEnabled, whatsappConsentAt: editWhatsappConsentAt,
    };
    // Finalizing a patient — delete future sessions and set inactive
    if (isFinalizingPatient) {
      const ok = await finalizePatient(selected.id, finishDate);
      if (ok) {
        haptic.success();
        // Also save any basic info changes (no status/rate on finalize).
        await updatePatient(selected.id, buildPatientEditPayload(editForm, nowIso));
        setSelected(null);
        setEditing(false);
      }
      return;
    }

    // Episodic patients have no perpetual slot — applyScheduleChange
    // would treat the placeholder schedules array as the new recurring
    // schedule and silently flip the patient to a slot they didn't
    // pick. Skip the schedule path entirely; only basic info + rate
    // can change for episodic patients here. (To switch them to
    // recurring, the user uses the dedicated "Cambiar a recurrentes"
    // affordance on Resumen, which seeds the schedule properly.)
    const editedIsEpisodic = isEpisodic(selected);
    if (!editedIsEpisodic && scheduleOrRateChanged()) {
      // Schedule or rate changed — apply with effective date
      const ok = await applyScheduleChange(selected.id, {
        schedules: editSchedules,
        rate: Number(editRate) || 0,
        effectiveDate,
        endDate: hasEndDate ? endDate : undefined,
      });
      if (ok) {
        // Also save basic info (schedule path includes status, not rate —
        // rate is applied via applyScheduleChange above).
        await updatePatient(selected.id, buildPatientEditPayload(editForm, nowIso, { includeStatus: true }));
        setSelected(null);
        setEditing(false);
      }
    } else {
      // Only basic info changed — includes both status and rate.
      const ok = await updatePatient(selected.id, buildPatientEditPayload(editForm, nowIso, { includeStatus: true, includeRate: true }));
      if (ok) {
        setSelected(null);
        setEditing(false);
      }
    }
  };

  return {
    editName, setEditName,
    editIsMinor, setEditIsMinor,
    editParent, setEditParent,
    editRate, setEditRate,
    editOpeningAmount, setEditOpeningAmount,
    editOpeningDir, setEditOpeningDir,
    editTutorFrequency, setEditTutorFrequency,
    editPhone, setEditPhone,
    editEmail, setEditEmail,
    editWhatsappEnabled, setEditWhatsappEnabled,
    editWhatsappConsentAt, setEditWhatsappConsentAt,
    editBirthdate, setEditBirthdate,
    editStartDate, setEditStartDate,
    editStatus, setEditStatus,
    editSchedules, setEditSchedules,
    effectiveDate, setEffectiveDate,
    hasEndDate, setHasEndDate,
    endDate, setEndDate,
    finishDate, setFinishDate,
    origRate, origSchedules,
    openEditForPatient,
    updateEditSched,
    scheduleOrRateChanged,
    isFinalizingPatient,
    saveEdit,
  };
}
