-- 079_sessions_user_date_index.sql
-- Composite (user_id, date) index on sessions to speed the common
-- "this user's sessions on a given day" access pattern (Agenda day view,
-- per-date filters) that today leans on idx_sessions_user_id alone.
--
-- HONEST CAVEAT: sessions.date is a "D-MMM" Spanish short-date STRING
-- (e.g. "8-Abr"), not an ISO date. So this index accelerates EQUALITY on
-- an exact date string (user_id = X AND date = '8-Abr'), NOT chronological
-- range scans (BETWEEN two months) — strings don't sort by calendar
-- order. The real range-scan fix is a proper ISO `date` column, which is
-- deliberately OUT OF SCOPE here because it touches the date-format
-- invariant threaded through parsers, triggers, and the accounting audit.
--
-- Apply with CONCURRENTLY so it never blocks writes on a large sessions
-- table. CONCURRENTLY cannot run inside a transaction block — apply via
-- the Supabase Management API query endpoint (not a wrapped runner), then
-- regenerate supabase/schema.snapshot.json:
--   node --env-file=.env.local scripts/schema-snapshot.mjs --update
create index concurrently if not exists idx_sessions_user_date
  on public.sessions (user_id, date);
