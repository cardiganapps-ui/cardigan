-- Migration 044: per-session recurrence frequency.
--
-- Patients can now have schedules at weekly / biweekly (every 2 weeks)
-- / monthly (every 4 weeks) cadence. The frequency is a property of the
-- slot (the patient's regular Lunes-14:00 spot, etc.), so we store it
-- on every session row in that slot. Each session in a recurring slot
-- carries the same value. Reading frequency from any session in the
-- slot tells the auto-extend logic which stride to project forward at.
--
-- Existing rows are backfilled to 'weekly' via the column default —
-- the entire pre-migration corpus was implicitly weekly.

alter table sessions
  add column if not exists recurrence_frequency text not null default 'weekly';

alter table sessions
  drop constraint if exists sessions_recurrence_frequency_check;
alter table sessions
  add constraint sessions_recurrence_frequency_check
  check (recurrence_frequency in ('weekly', 'biweekly', 'monthly'));
