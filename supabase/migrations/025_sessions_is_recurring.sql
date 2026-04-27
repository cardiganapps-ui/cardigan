-- Explicit recurring vs. one-off flag for sessions.
--
-- Background: a user reported that one-off appointments she'd
-- intended as tutor sessions were sometimes saved as
-- session_type='regular' (when she forgot to toggle the
-- session-type picker in NewSessionSheet) and then mis-classified
-- by the auto-extend logic as the anchor of a recurring weekly
-- slot. Code-side guards in commit 5f8a878 (date filter) and the
-- subsequent ≥2-future-sessions filter handle the pattern, but the
-- *structural* fix is to record at INSERT time whether a session
-- was created as part of a recurring schedule or as a manual
-- one-off — and have the auto-extend logic only consider
-- recurring-flagged rows when deriving the schedule.
--
-- Default is FALSE: any future code path that creates sessions and
-- forgets to set the flag falls into the safe "one-off" bucket. The
-- four legitimate code paths (patient creation seed, schedule edit
-- regeneration, auto-extend, and any cron-driven extension)
-- explicitly set is_recurring=true.
--
-- All existing rows are backfilled to TRUE — at the time they were
-- inserted, every session WAS created via a recurring path
-- (manual one-offs accidentally fed the schedule, but the rows
-- themselves were inserted by the same code as recurring rows).
-- We don't try to retroactively flag historical phantoms here —
-- per user direction those past rows are hers to clean up; the
-- ≥2-future-sessions guard in computeAutoExtendRows prevents
-- them from re-seeding regardless of the flag.

-- Idempotent: re-running this script after a partial failure is safe.
alter table sessions add column if not exists is_recurring boolean;
update sessions set is_recurring = true where is_recurring is null;
alter table sessions alter column is_recurring set default false;
alter table sessions alter column is_recurring set not null;
