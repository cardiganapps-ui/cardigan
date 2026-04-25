-- 016 introduced admin_analytics_daily(int) which returns
--   table(day date, signups int, active_users int, sessions_created int, payments_created int)
-- The activity CTE referenced bare `day` in SELECT and GROUP BY:
--
--   select day, count(distinct user_id)::int as cnt
--   from (...) t
--   group by day
--
-- Postgres treats this as ambiguous because the function's OUT parameter
-- `day` is in scope across the entire body, colliding with t.day. Live
-- callers see "column reference 'day' is ambiguous" and the Métricas tab
-- fails to load. Re-create the function with `t.day` qualifiers so the
-- subquery column is referenced unambiguously.

create or replace function public.admin_analytics_daily(days int default 30)
returns table (
  day date,
  signups int,
  active_users int,
  sessions_created int,
  payments_created int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  span_days int := greatest(1, least(coalesce(days, 30), 365));
  start_at timestamptz := (current_date - (span_days - 1))::timestamptz;
begin
  if not is_admin() then
    raise exception 'Forbidden';
  end if;

  return query
  with date_series as (
    select generate_series(current_date - (span_days - 1), current_date, '1 day'::interval)::date as day
  ),
  signups as (
    select created_at::date as day, count(*)::int as cnt
    from auth.users
    where created_at >= start_at
    group by created_at::date
  ),
  activity as (
    select t.day, count(distinct t.user_id)::int as cnt
    from (
      select user_id, created_at::date as day from sessions where created_at >= start_at
      union all
      select user_id, created_at::date as day from payments where created_at >= start_at
      union all
      select user_id, updated_at::date as day from notes where updated_at >= start_at
      union all
      select user_id, created_at::date as day from documents where created_at >= start_at
    ) t
    group by t.day
  ),
  sessions_per_day as (
    select created_at::date as day, count(*)::int as cnt
    from sessions
    where created_at >= start_at
    group by created_at::date
  ),
  payments_per_day as (
    select created_at::date as day, count(*)::int as cnt
    from payments
    where created_at >= start_at
    group by created_at::date
  )
  select
    d.day,
    coalesce(s.cnt, 0) as signups,
    coalesce(a.cnt, 0) as active_users,
    coalesce(sp.cnt, 0) as sessions_created,
    coalesce(pp.cnt, 0) as payments_created
  from date_series d
  left join signups       s  on s.day  = d.day
  left join activity      a  on a.day  = d.day
  left join sessions_per_day sp on sp.day = d.day
  left join payments_per_day pp on pp.day = d.day
  order by d.day;
end;
$$;
