-- 067 — DB constraint hardening (Tier 3)
--
-- Moves invariants that already live in JS into the schema, so a bug
-- in any client (including a future one we haven't written yet) can't
-- silently corrupt the database. Every constraint added here was
-- audited against production first — see commit message for the
-- counts. All currently zero violations.
--
-- Pattern: NOT VALID + VALIDATE in two statements, even when the audit
-- shows zero violations, because:
--   • NOT VALID takes a brief ACCESS EXCLUSIVE lock to add the
--     constraint definition.
--   • VALIDATE runs without blocking writes (just a SHARE UPDATE
--     EXCLUSIVE lock) and scans the existing rows.
-- This keeps the migration online-safe even if the data audit missed
-- a recent edge case.

-- ── Patients counter non-negativity ─────────────────────────────────
-- patients.rate already has check (rate >= 0). Add the same guard to
-- the three denormalized counters that recalcPatientCounters and the
-- mutation hooks all clamp to >= 0 in JS.
alter table patients add constraint patients_paid_nonneg     check (paid >= 0)     not valid;
alter table patients add constraint patients_billed_nonneg   check (billed >= 0)   not valid;
alter table patients add constraint patients_sessions_nonneg check (sessions >= 0) not valid;
alter table patients validate constraint patients_paid_nonneg;
alter table patients validate constraint patients_billed_nonneg;
alter table patients validate constraint patients_sessions_nonneg;

-- ── Session physical soundness ──────────────────────────────────────
-- rate may be null (falls back to patient.rate); when present it
-- must be non-negative. duration is always set and must be positive.
alter table sessions add constraint sessions_rate_nonneg
  check (rate is null or rate >= 0) not valid;
alter table sessions add constraint sessions_duration_positive
  check (duration is not null and duration > 0) not valid;
alter table sessions validate constraint sessions_rate_nonneg;
alter table sessions validate constraint sessions_duration_positive;

-- ── Non-empty text invariants ───────────────────────────────────────
-- The columns are NOT NULL but Postgres still allows empty strings;
-- JS-side helpers (getInitials, createSession, etc.) all reject empty
-- input — lock that in at the DB layer too.
alter table patients add constraint patients_name_nonempty
  check (length(name) > 0) not valid;
alter table patients add constraint patients_initials_nonempty
  check (length(initials) > 0) not valid;
alter table sessions add constraint sessions_patient_nonempty
  check (length(patient) > 0) not valid;
alter table sessions add constraint sessions_initials_nonempty
  check (length(initials) > 0) not valid;
alter table payments add constraint payments_patient_nonempty
  check (length(patient) > 0) not valid;
alter table payments add constraint payments_initials_nonempty
  check (length(initials) > 0) not valid;
alter table patients validate constraint patients_name_nonempty;
alter table patients validate constraint patients_initials_nonempty;
alter table sessions validate constraint sessions_patient_nonempty;
alter table sessions validate constraint sessions_initials_nonempty;
alter table payments validate constraint payments_patient_nonempty;
alter table payments validate constraint payments_initials_nonempty;

-- ── Date format invariants ──────────────────────────────────────────
-- Canonical form is "D-MMM" with Spanish 3-letter month, optionally
-- suffixed with "-YY". Migration 008 already normalized legacy
-- space-separated forms; this constraint prevents regression. utils/
-- dates.js (formatShortDate / normalizeShortDate) emits exactly this
-- shape so every write should pass.
--
-- Regex split as a constant via a helper match — POSIX regex inline
-- per column to keep the migration self-contained.
alter table sessions add constraint sessions_date_format
  check (date ~ '^([1-9]|[12][0-9]|3[01])-(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)(-[0-9]{2})?$') not valid;
alter table payments add constraint payments_date_format
  check (date ~ '^([1-9]|[12][0-9]|3[01])-(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)(-[0-9]{2})?$') not valid;
alter table expenses add constraint expenses_date_format
  check (date ~ '^([1-9]|[12][0-9]|3[01])-(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)(-[0-9]{2})?$') not valid;
alter table sessions validate constraint sessions_date_format;
alter table payments validate constraint payments_date_format;
alter table expenses validate constraint expenses_date_format;

-- ── Time format invariants ──────────────────────────────────────────
-- Sessions are the only table with a wall-clock time column.
alter table sessions add constraint sessions_time_format
  check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') not valid;
alter table sessions validate constraint sessions_time_format;
