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

// Auto-extend recurring sessions: if a patient's last scheduled session is
// within RECURRENCE_EXTEND_THRESHOLD_DAYS of today, append another
// RECURRENCE_WINDOW_WEEKS weeks of sessions. The same window is also used as
// the default end for getRecurringDates(), so both values live here.
// Window = 15 weeks (105 days) so the 3-month projection (90 days) is always complete.
// Threshold = 105 days so every patient gets re-extended on each load if needed.
export const RECURRENCE_EXTEND_THRESHOLD_DAYS = 105;
export const RECURRENCE_WINDOW_WEEKS = 15;
