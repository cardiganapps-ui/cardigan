-- 080_session_counts_created_at_anchor.sql
--
-- C1 fix — anchor the yearless-date year inference on the session's
-- created_at instead of now().
--
-- Session dates are stored yearless ("D-MMM"). session_counts_at inferred
-- the year as whichever of [year-1, year, year+1] lands closest to `now`.
-- For a status='scheduled' row whose true date is more than ~6 months in
-- the past, that heuristic flips the inferred year into the FUTURE, so the
-- session stops satisfying `now >= session_end` and silently drops out of
-- the `billed` (consumed) counter — understating the balance. Because the
-- in-app JS predicate, the Cardi predicate, and the audit script all shared
-- the same now-anchoring, the drift was invisible to the nightly audit.
--
-- created_at is always within the recurrence window of the true session
-- date (auto-extend writes at most ~15 weeks ahead; manual adds are near
-- "now"), so it is a stable, correct anchor that never drifts as time
-- passes. The "has it passed" comparison still uses `now` (ref).
--
-- Mirrors the JS change in src/utils/accounting.ts::sessionEndMoment,
-- api/_cardiTools.ts, and scripts/audit-accounting.mjs (same commit).
--
-- Apply, then regenerate the schema snapshot:
--   node --env-file=.env.local scripts/schema-snapshot.mjs --update

-- session_counts_at gains a sixth arg (p_created_at). Drop the old 5-arg
-- signature first so we don't leave two overloads that make a 5-arg call
-- ambiguous. The new arg defaults to null, in which case behaviour falls
-- back to the previous now-anchoring.
drop function if exists public.session_counts_at(text, text, text, text, timestamptz);

create or replace function public.session_counts_at(
  p_status text, p_date text, p_time text, p_tz text, ref timestamptz, p_created_at timestamptz default null
) returns boolean language plpgsql immutable parallel safe as $$
declare
  parts text[];
  d_num smallint; mon text; m smallint;
  yr_suffix text; y smallint;
  hh smallint := 0; mm smallint := 0;
  tp text[];
  session_end_local timestamp;
  session_end_at timestamptz;
  anchor timestamptz := coalesce(p_created_at, ref);
begin
  if p_status = 'completed' or p_status = 'charged' then return true; end if;
  if p_status <> 'scheduled' then return false; end if;
  parts := regexp_match(p_date, '^([0-9]+)-(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)(?:-([0-9]{2}))?$');
  if parts is null then return false; end if;
  d_num := parts[1]::smallint;
  mon := parts[2];
  m := public.spanish_month_idx(mon);
  if m is null then return false; end if;
  yr_suffix := parts[3];
  if yr_suffix is not null then
    y := (2000 + yr_suffix::smallint)::smallint;
  else
    -- Anchor on created_at (falls back to ref/now when null), not ref.
    y := public.infer_short_date_year(m, d_num, anchor, p_tz);
  end if;
  tp := string_to_array(p_time, ':');
  if array_length(tp, 1) >= 2 then
    hh := tp[1]::smallint; mm := tp[2]::smallint;
  end if;
  begin
    session_end_local := make_timestamp(y::int, m::int, d_num::int, hh::int, mm::int, 0) + interval '1 hour';
  exception when others then return false;
  end;
  session_end_at := session_end_local at time zone p_tz;
  -- "has the slot passed" still compares against now (ref), not the anchor.
  return ref >= session_end_at;
end;
$$;

-- Pass the row's created_at through from the counter recompute.
create or replace function public.recalc_patient_session_counters(p_patient_id uuid)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_patient_rate integer; v_user_id uuid; v_tz text; v_tz_valid boolean;
  v_sessions integer; v_billed integer;
  v_now timestamptz := now();
begin
  select rate, user_id into v_patient_rate, v_user_id from patients where id = p_patient_id;
  if v_user_id is null then return; end if;
  select coalesce(timezone, 'America/Mexico_City') into v_tz
    from notification_preferences where user_id = v_user_id;
  if v_tz is null then v_tz := 'America/Mexico_City'; end if;
  select exists(select 1 from pg_timezone_names where name = v_tz) into v_tz_valid;
  if not v_tz_valid then v_tz := 'America/Mexico_City'; end if;
  select count(*)::integer into v_sessions from sessions where patient_id = p_patient_id;
  select coalesce(sum(coalesce(s.rate, v_patient_rate, 0)), 0)::integer into v_billed
    from sessions s
    where s.patient_id = p_patient_id
      and public.session_counts_at(s.status, s.date, s.time, v_tz, v_now, s.created_at);
  update patients set sessions = coalesce(v_sessions, 0), billed = coalesce(v_billed, 0)
    where id = p_patient_id;
end;
$$;
