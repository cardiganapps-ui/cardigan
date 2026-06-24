/* ── New-patient / new-potential submit payloads (WS-6) ───────────────
   NewPatientSheet built two camelCase creation payloads inline in its
   ~100-line `submit` handler: the full patient (onSubmit → createPatient)
   and the slim potential (onPotentialSubmit → createPotential). Both carry
   money-adjacent normalization — the signed opening balance, the WhatsApp
   opt-in gate (only ON when a phone is present), tutor-frequency / health-
   field gating, and the episodic-vs-recurring schedule shaping — on a
   component that has NO tests. Extracting them here gives that logic a
   single tested home (parallel to buildPatientEditPayload on the edit side).

   ⚠️ Faithful to a deliberate asymmetry in the original code: the FULL
   patient payload passes `name`/`parent` UNTRIMMED (the create hook trims
   server-side), while the POTENTIAL payload trims them. Preserved verbatim
   — do not "tidy" one to match the other without checking both consumers. */

import { phoneDigits } from "../../utils/contact";
import { signedOpeningBalance } from "../../utils/openingBalance";
import { SCHEDULING_MODE } from "../../data/constants";

export interface Schedule {
  day: string;
  time: string;
  duration: string;
  modality: string;
  frequency: string;
}

export interface NewPatientFormState {
  name: string;
  isMinor: boolean;
  parent: string;
  rate: string;
  openingBalanceAmount: string;
  openingBalanceDir: string;
  tutorFrequency: string;
  phone: string;
  email: string;
  whatsappEnabled: boolean;
  externalFolderUrl: string;
  birthdate: string;
  /** birthdate === todayISO() — the default-filled, never-touched state. */
  birthdateUntouched: boolean;
  /** Profession-derived (usesAnthropometrics) — gates the health columns. */
  showHealthFields: boolean;
  heightCm: string;
  goalWeightKg: string;
  goalBodyFatPct: string;
  goalSkeletalMuscleKg: string;
  allergies: string;
  medicalConditions: string;
  schedulingMode: string;
  schedules: Schedule[];
  startDate: string;
  hasEndDate: boolean;
  endDate: string;
  skipFirstConsult: boolean;
  firstConsultDate: string;
  firstConsultTime: string;
  firstConsultDuration: string;
  firstConsultModality: string;
}

/** The full new-patient payload (step 2 of the wizard → onSubmit). */
export function buildNewPatientPayload(f: NewPatientFormState): Record<string, unknown> {
  const isEpisodicMode = f.schedulingMode === SCHEDULING_MODE.EPISODIC;
  return {
    // NOTE: name/parent intentionally NOT trimmed here (see header).
    name: f.name,
    parent: f.isMinor ? f.parent : "",
    rate: Number(f.rate) || 0,
    openingBalance: signedOpeningBalance(f.openingBalanceAmount, f.openingBalanceDir),
    tutorFrequency: f.isMinor && f.tutorFrequency ? Number(f.tutorFrequency) : null,
    phone: phoneDigits(f.phone),
    email: f.email.trim(),
    whatsappEnabled: f.whatsappEnabled && !!phoneDigits(f.phone),
    externalFolderUrl: f.externalFolderUrl.trim() || null,
    birthdate: (f.birthdate && !f.birthdateUntouched) ? f.birthdate : null,
    // Health fields. Server-side they're always present as columns; we just
    // don't surface the form section unless the profession actually uses them.
    heightCm: f.showHealthFields && f.heightCm ? Number(f.heightCm) : null,
    goalWeightKg: f.showHealthFields && f.goalWeightKg ? Number(f.goalWeightKg) : null,
    goalBodyFatPct: f.showHealthFields && f.goalBodyFatPct ? Number(f.goalBodyFatPct) : null,
    goalSkeletalMuscleKg: f.showHealthFields && f.goalSkeletalMuscleKg ? Number(f.goalSkeletalMuscleKg) : null,
    allergies: f.showHealthFields ? f.allergies.trim() : "",
    medicalConditions: f.showHealthFields ? f.medicalConditions.trim() : "",
    schedulingMode: f.schedulingMode,
    // Recurring path: today's params are unchanged. Episodic path: clear the
    // weekly slot fields; the hook ignores them when schedulingMode==='episodic'
    // and reads the optional first consult instead.
    schedules: isEpisodicMode ? [] : f.schedules,
    recurring: !isEpisodicMode,
    startDate: isEpisodicMode ? null : f.startDate,
    endDate: !isEpisodicMode && f.hasEndDate ? f.endDate : null,
    firstConsult: isEpisodicMode && !f.skipFirstConsult && f.firstConsultDate ? {
      date: f.firstConsultDate,
      time: f.firstConsultTime,
      duration: Number(f.firstConsultDuration) || 60,
      modality: f.firstConsultModality,
    } : null,
  };
}

/** The slim potential payload (single-step potential mode → onPotentialSubmit). */
export function buildPotentialPayload(f: NewPatientFormState): Record<string, unknown> {
  return {
    name: f.name.trim(),
    parent: f.isMinor ? f.parent.trim() : "",
    rate: Number(f.rate) || 0,
    phone: phoneDigits(f.phone),
    email: f.email.trim(),
    whatsappEnabled: f.whatsappEnabled && !!phoneDigits(f.phone),
    interview: {
      date: f.firstConsultDate,
      time: f.firstConsultTime,
      duration: Number(f.firstConsultDuration) || 60,
      modality: f.firstConsultModality,
    },
  };
}
