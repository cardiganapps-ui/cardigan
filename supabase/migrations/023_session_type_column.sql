-- Promote the "T·" initials prefix to a first-class session_type column.
--
-- Until now, sessions where the appointment was with the patient's
-- parent/tutor (rather than the patient themselves) were marked by
-- prefixing the parent's initials with "T·" (e.g. "T·LG"). That
-- worked but couldn't be queried efficiently and leaked into every
-- read path (isTutorSession() in src/utils/sessions.js doing
-- startsWith("T·")).
--
-- This migration:
--   1. Adds sessions.session_type with a check constraint.
--   2. Backfills 'tutor' for existing rows whose initials start with T·,
--      'regular' for everything else.
--   3. Strips the "T·" prefix from those initials so the column is the
--      sole source of truth.
--
-- The frontend read path keeps the prefix-startsWith fallback during
-- the deploy window so it survives whichever migration runs first.

alter table sessions add column if not exists session_type text;
update sessions
  set session_type = case when initials like 'T·%' then 'tutor' else 'regular' end
  where session_type is null;
update sessions
  set initials = regexp_replace(initials, '^T·', '')
  where initials like 'T·%';
alter table sessions alter column session_type set default 'regular';
alter table sessions alter column session_type set not null;
alter table sessions drop constraint if exists sessions_session_type_check;
alter table sessions add constraint sessions_session_type_check
  check (session_type in ('regular', 'tutor'));
create index if not exists idx_sessions_session_type on sessions(session_type);
