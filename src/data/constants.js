/* ── Shared constants ──
   Single source of truth for DB enum values, business-logic thresholds, and
   other magic values that would otherwise be duplicated across hooks/screens. */

// Session status (must match supabase/schema.sql check constraint).
export const SESSION_STATUS = Object.freeze({
  SCHEDULED: "scheduled",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  CHARGED:   "charged",
});

// Patient lifecycle status.
export const PATIENT_STATUS = Object.freeze({
  ACTIVE: "active",
  ENDED:  "ended",
});

// Payment methods. Values double as DB strings and display labels (Spanish-only app).
export const PAYMENT_METHOD = Object.freeze({
  TRANSFER: "Transferencia",
  CASH:     "Efectivo",
  CARD:     "Tarjeta",
  CARDLESS: "Retiro sin Tarjeta",
  OTHER:    "Otro",
});
export const PAYMENT_METHODS = [
  PAYMENT_METHOD.TRANSFER,
  PAYMENT_METHOD.CASH,
  PAYMENT_METHOD.CARD,
  PAYMENT_METHOD.CARDLESS,
  PAYMENT_METHOD.OTHER,
];

// Admin email — kept in sync with supabase/schema.sql is_admin().
export const ADMIN_EMAIL = "gaxioladiego@gmail.com";

// User profession (multi-profession expansion). Locked at sign-up and
// admin-changeable. Values must match the user_profiles.profession check
// constraint in supabase/schema.sql / migrations/021_user_profiles.sql,
// AND the keys in src/i18n/vocabulary.js.
export const PROFESSION = Object.freeze({
  PSYCHOLOGIST:  "psychologist",
  NUTRITIONIST:  "nutritionist",
  TUTOR:         "tutor",
  MUSIC_TEACHER: "music_teacher",
  TRAINER:       "trainer",
});
export const PROFESSIONS = [
  PROFESSION.PSYCHOLOGIST,
  PROFESSION.NUTRITIONIST,
  PROFESSION.TUTOR,
  PROFESSION.MUSIC_TEACHER,
  PROFESSION.TRAINER,
];
// Phase-1 default for any code path that runs before the profile loads
// (or for users whose row hasn't been backfilled). Existing users are
// all psychologists per migration 021.
export const DEFAULT_PROFESSION = PROFESSION.PSYCHOLOGIST;

// Clinical professions handle sensitive health data and the at-rest
// note encryption affordance is surfaced for them by default. Tutor /
// music / trainer don't write clinical notes, so the encryption setup
// prompt is hidden for those — they can still see existing encrypted
// notes if they previously set it up under a different profession.
export const CLINICAL_PROFESSIONS = new Set([
  PROFESSION.PSYCHOLOGIST,
  PROFESSION.NUTRITIONIST,
]);

export function isClinicalProfession(profession) {
  return CLINICAL_PROFESSIONS.has(profession);
}

// Professions whose workflow includes tracking client weight, body
// measurements, and other anthropometric data over time. Gates the
// "Mediciones" tab in the expediente, the nutrition/fitness fields on
// the patient form, and the related demo seed.
export const ANTHROPOMETRIC_PROFESSIONS = new Set([
  PROFESSION.NUTRITIONIST,
  PROFESSION.TRAINER,
]);

export function usesAnthropometrics(profession) {
  return ANTHROPOMETRIC_PROFESSIONS.has(profession);
}

// Scheduling mode — per-patient, NOT per-profession. Profession sets
// the default in the UI; every patient can flip either way.
//   'recurring' — today's perpetual weekly slot model. Auto-extend
//                 regenerates future weekly rows. Default for
//                 psychologist / tutor / music_teacher / trainer.
//   'episodic'  — no perpetual slot. The practitioner schedules the
//                 next visit at the end of each consult (how
//                 nutritionists actually work). Auto-extend no-ops.
//                 Default for nutritionist.
// Mirrors the patients.scheduling_mode CHECK constraint in
// migrations/040_scheduling_mode.sql — keep these in sync.
export const SCHEDULING_MODE = Object.freeze({
  RECURRING: "recurring",
  EPISODIC:  "episodic",
});

const SCHEDULING_DEFAULTS = Object.freeze({
  psychologist:  SCHEDULING_MODE.RECURRING,
  nutritionist:  SCHEDULING_MODE.EPISODIC,
  tutor:         SCHEDULING_MODE.RECURRING,
  music_teacher: SCHEDULING_MODE.RECURRING,
  trainer:       SCHEDULING_MODE.RECURRING,
});

export function defaultSchedulingMode(profession) {
  return SCHEDULING_DEFAULTS[profession] ?? SCHEDULING_MODE.RECURRING;
}

export function isEpisodic(patient) {
  return patient?.scheduling_mode === SCHEDULING_MODE.EPISODIC;
}

// Session modality. Values must match the sessions.modality check
// constraint in supabase/schema.sql / migrations/020 + 022. Per-profession
// subsets live in MODALITIES_BY_PROFESSION below — the dropdowns and the
// "cycle" tap-toggle on existing sessions render only the active profession's
// allowed modalities. Existing DB rows that fall outside the profession's
// subset are preserved (the tap-toggle defensively recognises any value).
export const MODALITY = Object.freeze({
  PRESENCIAL:   "presencial",
  VIRTUAL:      "virtual",
  TELEFONICA:   "telefonica",
  A_DOMICILIO:  "a-domicilio",
});

export const MODALITIES_BY_PROFESSION = Object.freeze({
  psychologist:  ["presencial", "virtual", "telefonica"],
  nutritionist:  ["presencial", "a-domicilio", "virtual"],
  tutor:         ["presencial", "a-domicilio", "virtual"],
  music_teacher: ["presencial", "a-domicilio", "virtual"],
  trainer:       ["presencial", "a-domicilio", "virtual"],
});

// Maps a raw modality value to the i18n key suffix used by t().
// Hyphenated values can't be used as object literal keys without quoting,
// so 'a-domicilio' resolves to 'aDomicilio' in es.js.
export const MODALITY_I18N_KEY = Object.freeze({
  presencial:    "presencial",
  virtual:       "virtual",
  telefonica:    "telefonica",
  "a-domicilio": "aDomicilio",
});

export function getModalitiesForProfession(profession) {
  return MODALITIES_BY_PROFESSION[profession]
    ?? MODALITIES_BY_PROFESSION[DEFAULT_PROFESSION];
}

// Auto-extend recurring sessions: if a patient's last scheduled session is
// within RECURRENCE_EXTEND_THRESHOLD_DAYS of today, append another
// RECURRENCE_WINDOW_WEEKS weeks of sessions. The same window is also used as
// the default end for getRecurringDates(), so both values live here.
// Window = 15 weeks (105 days) so the 3-month projection (90 days) is always complete.
// Threshold = 105 days so every patient gets re-extended on each load if needed.
export const RECURRENCE_EXTEND_THRESHOLD_DAYS = 105;
export const RECURRENCE_WINDOW_WEEKS = 15;
