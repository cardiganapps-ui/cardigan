-- ── 057_session_reschedule_audit.sql ──
-- Patient self-serve reschedule (Chapter A in the Calendly-gap
-- bridging plan). When a patient reschedules from PatientHome, we
-- update the session's date/time IN PLACE so the row id is stable
-- (notes / cancellation history / pending push reminders all stay
-- attached). To preserve the audit trail of "originally booked at
-- X", stamp the previous slot + the time of the reschedule on the
-- row itself.
--
-- These columns are also written by the therapist-side reschedule
-- path (useSessions.js::rescheduleSession) so future surfaces
-- ("este paciente reagendó hace 2 días" badge, etc) work for both
-- origins. Backfill is a no-op — rows without a reschedule have
-- both columns NULL.

alter table sessions
  add column if not exists last_rescheduled_at timestamptz;

alter table sessions
  add column if not exists last_rescheduled_from jsonb;
-- last_rescheduled_from shape: { date: "8-Abr", time: "16:00" }
-- (kept JSON so future fields like duration / modality can be
-- captured without another migration).
