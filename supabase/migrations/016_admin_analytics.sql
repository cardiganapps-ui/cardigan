-- Admin analytics RPCs.
--
-- Two security-definer functions read aggregated stats across every
-- user and return them as JSON. Both gate on is_admin() at the top so a
-- non-admin caller gets a clean exception rather than incomplete data.
--
-- Why JSON instead of relations: the AdminPanel "Métricas" tab needs a
-- single round-trip per refresh and consumes the result as-is. Returning
-- a JSON blob keeps the call sites tiny and avoids per-row supabase-js
-- transformer overhead for tiny result sets (overview is one row; the
-- daily series is ~30 rows).
--
-- Privacy: nothing in the return values identifies a specific user.
-- Counts and sums only.

create or replace function public.admin_analytics_overview()
returns json
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  result json;
  thirty_days_ago timestamptz := now() - interval '30 days';
begin
  if not is_admin() then
    raise exception 'Forbidden';
  end if;

  with active_users_30d as (
    select user_id from sessions where created_at >= thirty_days_ago
    union
    select user_id from payments where created_at >= thirty_days_ago
    union
    select user_id from notes where updated_at >= thirty_days_ago
    union
    select user_id from documents where created_at >= thirty_days_ago
  )
  select json_build_object(
    'users_total',         (select count(*) from auth.users),
    'users_blocked',       (select count(*) from auth.users where banned_until is not null and banned_until > now()),
    'users_signups_30d',   (select count(*) from auth.users where created_at >= thirty_days_ago),
    'users_active_30d',    (select count(distinct user_id) from active_users_30d),
    'patients_total',      (select count(*) from patients),
    'sessions_total',      (select count(*) from sessions),
    'sessions_30d',        (select count(*) from sessions where created_at >= thirty_days_ago),
    'payments_total',      (select count(*) from payments),
    'payments_30d',        (select count(*) from payments where created_at >= thirty_days_ago),
    'money_tracked_total', (select coalesce(sum(amount), 0) from payments),
    'money_tracked_30d',   (select coalesce(sum(amount), 0) from payments where created_at >= thirty_days_ago),
    'notes_total',         (select count(*) from notes),
    'documents_total',     (select count(*) from documents),
    'push_subscriptions',  (select count(*) from push_subscriptions),
    'as_of',               now()
  ) into result;

  return result;
end;
$$;

revoke execute on function public.admin_analytics_overview() from public;
revoke execute on function public.admin_analytics_overview() from anon;
grant execute on function public.admin_analytics_overview() to authenticated;


-- Per-day series for the last `days` days. Used for the bar chart in
-- the MetricsTab. We left-join against a generated date series so days
-- with zero activity still appear in the result (otherwise the chart
-- would skip empty days and misrepresent gaps as continuous bars).
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
set search_path = public, auth
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
    -- t.day must be qualified — the function's OUT parameter `day` is in
    -- scope across the body, so a bare `day` collides ambiguously.
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

revoke execute on function public.admin_analytics_daily(int) from public;
revoke execute on function public.admin_analytics_daily(int) from anon;
grant execute on function public.admin_analytics_daily(int) to authenticated;
