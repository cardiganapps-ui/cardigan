-- Migration 047: interview-stage / potential patients.
--
-- Adds two new patient lifecycle states and a new session subtype to
-- support the "interview before becoming a real patient" flow:
--
--   patients.status:
--     'potential'  — interviewee under evaluation. Not yet enrolled,
--                    not counted in active-patient KPIs, never picked
--                    up by recurring auto-extend. Created via
--                    NewPotentialSheet, can be promoted to 'active'
--                    via ConvertPotentialSheet (which preserves the
--                    interview session as part of the patient's
--                    history) or soft-archived to 'discarded'.
--     'discarded'  — soft-archive for potentials that didn't convert.
--                    Hidden by default; visible under the "Archivados"
--                    sub-filter in the Potenciales view. Their
--                    interview session is also flipped to
--                    status='cancelled' on discard so it drops out of
--                    the .ics feed and the reminder cron without
--                    extra plumbing.
--
--   sessions.session_type:
--     'interview'  — the slim first-contact session a therapist
--                    schedules with a potential. Visually distinct
--                    (rose accent), surfaces as "Entrevista" /
--                    "Clase de prueba" / "Evaluación inicial" /
--                    "Consulta inicial" depending on profession via
--                    the i18n vocabulary swap. Always created with
--                    is_recurring=false so it never seeds a recurring
--                    slot, even if the patient is later converted to
--                    active+recurring.
--
-- Mirrored in src/data/constants.js (PATIENT_STATUS, SESSION_TYPE)
-- and supabase/schema.sql.

alter table patients
  drop constraint if exists patients_status_check;
alter table patients
  add constraint patients_status_check
  check (status in ('active', 'ended', 'potential', 'discarded'));

alter table sessions
  drop constraint if exists sessions_session_type_check;
alter table sessions
  add constraint sessions_session_type_check
  check (session_type in ('regular', 'tutor', 'interview'));
