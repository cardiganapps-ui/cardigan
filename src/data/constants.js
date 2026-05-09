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

// Patient lifecycle status. 'active' / 'ended' are the regular
// patient lifecycle. 'potential' / 'discarded' are the interview
// stage (migration 047): a potential is an interviewee under
// evaluation, never counted in active-patient KPIs and never picked
// up by recurring auto-extend; discarded is a soft-archive for
// potentials that didn't convert. See isPotentialOrDiscarded() below
// for the canonical filter every KPI surface uses to keep the two
// lanes from contaminating each other's totals.
export const PATIENT_STATUS = Object.freeze({
  ACTIVE:    "active",
  ENDED:     "ended",
  POTENTIAL: "potential",
  DISCARDED: "discarded",
});

// "Regular" patient statuses — those that should appear in the main
// KPIs, lists, and accounting derivations. The Patients-screen filter
// chips for 'all' / 'active' / 'ended' / 'owes' / 'paid' all restrict
// to this set; only the dedicated 'potential' chip surfaces potentials
// + (under "Archivados") discarded.
export const REGULAR_PATIENT_STATUSES = Object.freeze([
  PATIENT_STATUS.ACTIVE,
  PATIENT_STATUS.ENDED,
]);

// True if the patient is in the interview lane and should be excluded
// from any therapist-facing total / list / picker that's about real
// active patients (Home outstanding KPI, Finances Balances, Cardi
// finance summary, etc.). Centralized so the filter doesn't drift
// across surfaces.
export function isPotentialOrDiscarded(p) {
  return p?.status === PATIENT_STATUS.POTENTIAL
      || p?.status === PATIENT_STATUS.DISCARDED;
}

// Per-session type. Mirrors the sessions.session_type CHECK in
// supabase/schema.sql / migrations 023 + 047. The original
// 'regular' / 'tutor' split lives in src/utils/sessions.js
// (isTutorSession, with a legacy "T·" initials-prefix fallback);
// 'interview' is the first-contact session created against a
// 'potential' patient and surfaces with a rose accent.
export const SESSION_TYPE = Object.freeze({
  REGULAR:   "regular",
  TUTOR:     "tutor",
  INTERVIEW: "interview",
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

// Expense categories. Mexican mental-health context — "consultorio" is the
// office/coworking line item, "formacion" covers supervisión clínica /
// cursos / congresos, "honorarios" is the meta-deduction (paying your own
// contador). The DB check constraint on expenses.category mirrors this list
// (supabase/migrations/059_expenses.sql).
export const EXPENSE_CATEGORY = Object.freeze({
  CONSULTORIO: "consultorio",
  SERVICIOS:   "servicios",
  SOFTWARE:    "software",
  INSUMOS:     "insumos",
  FORMACION:   "formacion",
  HONORARIOS:  "honorarios",
  TRANSPORTE:  "transporte",
  MARKETING:   "marketing",
  COMISIONES:  "comisiones",
  IMPUESTOS:   "impuestos",
  OTRO:        "otro",
});
export const EXPENSE_CATEGORIES = [
  EXPENSE_CATEGORY.CONSULTORIO,
  EXPENSE_CATEGORY.SERVICIOS,
  EXPENSE_CATEGORY.SOFTWARE,
  EXPENSE_CATEGORY.INSUMOS,
  EXPENSE_CATEGORY.FORMACION,
  EXPENSE_CATEGORY.HONORARIOS,
  EXPENSE_CATEGORY.TRANSPORTE,
  EXPENSE_CATEGORY.MARKETING,
  EXPENSE_CATEGORY.COMISIONES,
  EXPENSE_CATEGORY.IMPUESTOS,
  EXPENSE_CATEGORY.OTRO,
];

// Expense payment methods (smaller set than PAYMENT_METHOD — therapists pay
// expenses via fewer rails than they receive payments through). DB check
// constraint on expenses.payment_method mirrors this.
export const EXPENSE_PAYMENT_METHODS = [
  PAYMENT_METHOD.TRANSFER,
  PAYMENT_METHOD.CASH,
  PAYMENT_METHOD.CARD,
  PAYMENT_METHOD.OTHER,
];

// Tax treatment for the SAT axis. `personal` is excluded from the P&L view
// entirely — it lets the user keep one ledger without inflating their
// "egresos" with a gym membership or a personal Uber. `non_deductible` IS
// counted in egresos but flagged separately in the contador export.
export const TAX_TREATMENT = Object.freeze({
  DEDUCTIBLE:     "deductible",
  NON_DEDUCTIBLE: "non_deductible",
  PERSONAL:       "personal",
});
export const TAX_TREATMENTS = [
  TAX_TREATMENT.DEDUCTIBLE,
  TAX_TREATMENT.NON_DEDUCTIBLE,
  TAX_TREATMENT.PERSONAL,
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

// ── Signup acquisition source ──
// Captured during onboarding (step 2 after profession). Canonical
// values mirror the user_profiles.signup_source check constraint
// in migration 042. Adding a new option requires updating both
// the constraint and i18n/es.js (signupSource.options.*).
// 'other' always pairs with a free-form signup_source_detail.
export const SIGNUP_SOURCE = Object.freeze({
  INSTAGRAM: "instagram",
  FACEBOOK:  "facebook",
  TIKTOK:    "tiktok",
  GOOGLE:    "google",
  COLLEAGUE: "colleague",
  PODCAST:   "podcast",
  EVENT:     "event",
  OTHER:     "other",
});
export const SIGNUP_SOURCES = [
  SIGNUP_SOURCE.INSTAGRAM,
  SIGNUP_SOURCE.FACEBOOK,
  SIGNUP_SOURCE.TIKTOK,
  SIGNUP_SOURCE.GOOGLE,
  SIGNUP_SOURCE.COLLEAGUE,
  SIGNUP_SOURCE.PODCAST,
  SIGNUP_SOURCE.EVENT,
  SIGNUP_SOURCE.OTHER,
];
// Cutoff for "is this a new user who should be prompted for source?"
// User accounts created at or after this timestamp are eligible for
// the source step; older accounts (who already moved past the
// profession-only onboarding) are not backfill-prompted. Set to the
// deploy date.
export const SIGNUP_SOURCE_CUTOFF_ISO = "2026-05-04T00:00:00Z";
export const SIGNUP_SOURCE_DETAIL_MAX_LEN = 60;

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

// Per-session visit type — surfaces "where in the engagement is this
// visit?" Tagged automatically at create time (first session →
// 'intake', rest → 'followup') with manual override available. Other
// professions ignore the column entirely; the UI only surfaces it for
// the same set that uses anthropometric measurements (nutritionists
// + trainers, where the "intake / follow-up / maintenance" model is
// natural). Mirrors the sessions.visit_type CHECK in migration 041.
export const VISIT_TYPE = Object.freeze({
  INTAKE:      "intake",
  FOLLOWUP:    "followup",
  MAINTENANCE: "maintenance",
});

export const VISIT_TYPES = [
  VISIT_TYPE.INTAKE,
  VISIT_TYPE.FOLLOWUP,
  VISIT_TYPE.MAINTENANCE,
];

export function usesVisitTypes(profession) {
  // Same gate as Mediciones — the audiences who think clinically in
  // intake / follow-up / maintenance terms.
  return ANTHROPOMETRIC_PROFESSIONS.has(profession);
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

// Recurrence frequency for a patient's slot. Stored on every session
// row that's part of the recurring schedule (mirrors the
// recurrence_frequency check constraint in migration 044). The
// stride map is the canonical "how many days between consecutive
// sessions in this slot" — used by getRecurringDates and the
// auto-extend math. Treat 'monthly' as every 4 weeks rather than
// calendar-monthly so the day-of-week stays locked (a Lunes 14:00
// slot stays on Mondays); calendar-monthly would shift the weekday
// each month, which doesn't match how therapy / coaching slots
// actually work.
export const RECURRENCE_FREQUENCY = Object.freeze({
  WEEKLY:   "weekly",
  BIWEEKLY: "biweekly",
  MONTHLY:  "monthly",
});
export const RECURRENCE_FREQUENCIES = [
  RECURRENCE_FREQUENCY.WEEKLY,
  RECURRENCE_FREQUENCY.BIWEEKLY,
  RECURRENCE_FREQUENCY.MONTHLY,
];
export const RECURRENCE_STRIDE_DAYS = Object.freeze({
  [RECURRENCE_FREQUENCY.WEEKLY]:   7,
  [RECURRENCE_FREQUENCY.BIWEEKLY]: 14,
  [RECURRENCE_FREQUENCY.MONTHLY]:  28,
});
export const DEFAULT_RECURRENCE_FREQUENCY = RECURRENCE_FREQUENCY.WEEKLY;
