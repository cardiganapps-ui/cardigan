-- Per-session visit type — surfaces "where in the engagement is this
-- visit?" for nutrition + training workflows. Three values:
--
--   'intake'      — first contact, comprehensive evaluation
--   'followup'    — regular progression visit (the bulk of activity)
--   'maintenance' — post-goal check-in, low-frequency
--
-- The column is nullable so existing rows stay valid without a
-- backfill (we don't have a clean signal in legacy data to assign
-- a type retroactively, and forcing a value would be more confusing
-- than leaving it blank). New nutrition / trainer sessions are
-- tagged automatically by the client at creation time:
--   - First session per patient → 'intake'
--   - Subsequent → 'followup'
--   - Practitioner can override either via the UI.
--
-- Other professions (psychologist, tutor, music_teacher) ignore the
-- column entirely — the UI doesn't surface it for them, the seeder
-- doesn't write it, and the column stays null. Storing it on every
-- session row (rather than gating per-profession at the DB level)
-- means a future "nutritionist who picks up tutoring" can opt into
-- the same taxonomy without a migration.

alter table sessions
  add column if not exists visit_type text
    check (visit_type is null or visit_type in ('intake','followup','maintenance'));

-- Hot path: filter sessions by visit_type when computing demographics
-- (e.g. "active patients in maintenance phase"). The b-tree index is
-- partial — null rows aren't useful to scan and would dominate.
create index if not exists idx_sessions_visit_type
  on sessions(visit_type)
  where visit_type is not null;
