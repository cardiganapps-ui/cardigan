-- 086 — Session-history windowing (client fetch + server aggregate).
--
-- Problem: the client fetched EVERY session row on each load because
-- amountDue sums over the full history. A multi-year practice pulls
-- thousands of rows per cold start.
--
-- Design: partition the history on (created_at, liveness) into two
-- exactly-complementary sets, both anchored to ONE cutoff value the
-- client computes per load:
--
--   fetch_sessions_windowed(cutoff)  → rows the client hydrates:
--     created_at >= cutoff             (all recent activity)
--     OR still-live scheduled rows     (status='scheduled' AND the
--                                       date-aware predicate says it
--                                       has NOT happened yet) — these
--                                       feed Agenda, auto-extend and
--                                       slot-conflict logic regardless
--                                       of age.
--
--   session_consumed_before(cutoff)  → per-patient Σ(rate) over the
--     complement (created_at < cutoff AND NOT a still-future scheduled
--     row) restricted to rows that count toward balance:
--       completed / charged            (count regardless of date)
--       scheduled AND already happened (the auto-complete branch,
--                                       via public.session_counts_at —
--                                       the SAME predicate the counter
--                                       triggers and the nightly audit
--                                       use, so JS↔SQL parity carries
--                                       over unchanged).
--
-- The client then computes
--   consumed = session_consumed_before + Σ over fetched rows (JS predicate)
-- which is identical to the old full-history walk because the two sets
-- partition the history and each side applies the canonical predicate.
--
-- created_at (timestamptz) is the partition key — NOT sessions.date,
-- which is a yearless "D-MMM" text column. A pre-cutoff created_at can
-- still carry a future date (manual far-out scheduling), which is why
-- the still-future-scheduled escape hatch exists on the fetch side.
--
-- Both functions are SECURITY INVOKER: RLS on sessions/patients scopes
-- rows to auth.uid(); the explicit user_id filter is for index use.

create or replace function public.fetch_sessions_windowed(p_cutoff timestamptz)
returns setof public.sessions
language plpgsql stable
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tz text; v_tz_valid boolean;
  v_now timestamptz := now();
begin
  select coalesce(timezone, 'America/Mexico_City') into v_tz
    from notification_preferences where user_id = (select auth.uid());
  if v_tz is null then v_tz := 'America/Mexico_City'; end if;
  select exists(select 1 from pg_timezone_names where name = v_tz) into v_tz_valid;
  if not v_tz_valid then v_tz := 'America/Mexico_City'; end if;

  return query
    select s.* from sessions s
    where s.user_id = (select auth.uid())
      and (
        s.created_at >= p_cutoff
        or (
          s.status = 'scheduled'
          and not public.session_counts_at(s.status, s.date, s.time, v_tz, v_now, s.created_at)
        )
      );
end;
$$;

create or replace function public.session_consumed_before(p_cutoff timestamptz)
returns table(patient_id uuid, consumed bigint, session_count bigint)
language plpgsql stable
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tz text; v_tz_valid boolean;
  v_now timestamptz := now();
begin
  select coalesce(timezone, 'America/Mexico_City') into v_tz
    from notification_preferences where user_id = (select auth.uid());
  if v_tz is null then v_tz := 'America/Mexico_City'; end if;
  select exists(select 1 from pg_timezone_names where name = v_tz) into v_tz_valid;
  if not v_tz_valid then v_tz := 'America/Mexico_City'; end if;

  return query
    select
      s.patient_id,
      coalesce(sum(coalesce(s.rate, p.rate, 0)), 0)::bigint as consumed,
      count(*)::bigint as session_count
    from sessions s
    join patients p on p.id = s.patient_id
    where s.user_id = (select auth.uid())
      and s.patient_id is not null
      and s.created_at < p_cutoff
      -- complement of the fetch's live-scheduled escape hatch…
      and not (
        s.status = 'scheduled'
        and not public.session_counts_at(s.status, s.date, s.time, v_tz, v_now, s.created_at)
      )
      -- …restricted to rows that count toward balance (the canonical
      -- predicate: completed/charged always, scheduled only once the
      -- slot has passed; cancelled never).
      and public.session_counts_at(s.status, s.date, s.time, v_tz, v_now, s.created_at)
    group by s.patient_id;
end;
$$;

grant execute on function public.fetch_sessions_windowed(timestamptz) to authenticated;
grant execute on function public.session_consumed_before(timestamptz) to authenticated;
