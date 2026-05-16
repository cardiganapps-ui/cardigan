-- 070 — defensive tz lookup in recalc_patient_session_counters
--
-- Bug: if notification_preferences.timezone holds a value Postgres
-- can't interpret (typo like "Mexico", an old TZ alias, or an
-- explicit "GMT+6"), the `at time zone p_tz` inside session_counts_at
-- + infer_short_date_year throws invalid_parameter_value. The trigger
-- propagates the error out, aborting the session UPDATE that fired
-- it. Effect: that user can't edit ANY session until an admin fixes
-- the bad tz.
--
-- Fix: in recalc_patient_session_counters, validate the looked-up tz
-- against pg_timezone_names and fall back to America/Mexico_City if
-- it isn't a known IANA name. Same defense the JS audit script
-- already takes (it pins TZ=America/Mexico_City at the top of the
-- file). No schema change.

create or replace function public.recalc_patient_session_counters(p_patient_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_patient_rate integer;
  v_user_id uuid;
  v_tz text;
  v_tz_valid boolean;
  v_sessions integer;
  v_billed integer;
  v_now timestamptz := now();
begin
  select rate, user_id into v_patient_rate, v_user_id
    from patients where id = p_patient_id;
  if v_user_id is null then return; end if;

  -- User's tz from notification_preferences. Validate it against
  -- pg_timezone_names so a malformed value (typed by hand in some
  -- legacy migration, or a stale IANA alias the OS has dropped)
  -- doesn't blow up the session_counts_at chain and abort the
  -- triggering UPDATE. Default America/Mexico_City matches the JS
  -- audit script's TZ pin and notification_preferences's column
  -- default.
  select coalesce(timezone, 'America/Mexico_City') into v_tz
    from notification_preferences where user_id = v_user_id;
  if v_tz is null then v_tz := 'America/Mexico_City'; end if;
  select exists(select 1 from pg_timezone_names where name = v_tz) into v_tz_valid;
  if not v_tz_valid then v_tz := 'America/Mexico_City'; end if;

  select count(*)::integer into v_sessions
    from sessions where patient_id = p_patient_id;

  select coalesce(sum(coalesce(s.rate, v_patient_rate, 0)), 0)::integer into v_billed
    from sessions s
    where s.patient_id = p_patient_id
      and public.session_counts_at(s.status, s.date, s.time, v_tz, v_now);

  update patients
  set sessions = coalesce(v_sessions, 0),
      billed = coalesce(v_billed, 0)
  where id = p_patient_id;
end;
$$;
