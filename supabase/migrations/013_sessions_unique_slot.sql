-- Enforce that a patient can't have two session rows in the same slot
-- (same calendar date + start time). This closes the duplicate-session
-- bug: the pre-existing client-side dedup in applyScheduleChange /
-- computeAutoExtendRows compared by date-only, so a second schedule on
-- the same day+time would insert a dupe, and a regen that re-included a
-- past cancelled slot would also dupe. A DB constraint is the only
-- reliable guard — anything purely client-side can drift, race across
-- tabs, or silently regress.
--
-- PARTIAL index on patient_id NOT NULL because the column is nullable
-- (a payment/session can lose its patient_id via ON DELETE SET NULL).
-- Orphaned rows aren't expected for sessions (they cascade) but the
-- partial predicate keeps the index honest either way.
--
-- Prerequisite: any pre-existing duplicates must be cleaned up before
-- this migration runs, otherwise the index creation will fail. See
-- scripts/cleanup-duplicate-sessions.mjs or the one-shot SQL in the
-- companion PR description.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sessions_patient_date_time
  ON sessions (patient_id, date, time)
  WHERE patient_id IS NOT NULL;
