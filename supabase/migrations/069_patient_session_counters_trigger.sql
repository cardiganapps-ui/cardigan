-- 069 — patient.sessions and patient.billed maintained by trigger
--
-- Completes the cross-table invariants thread (068 covered paid).
-- Migrates the JS-side counter math for the remaining two columns
-- into the database. After this migration:
--   • Every session INSERT/UPDATE/DELETE atomically recomputes
--     patient.sessions = COUNT(*) and patient.billed = Σ rate over
--     sessions matching the canonical predicate.
--   • Hooks no longer need .update({ sessions: …, billed: … }) calls.
--   • update_session_status_atomic (RPC) no longer carries
--     p_billed_delta — the trigger handles it. We DROP the prior
--     5-arg overload and recreate with 4 args (the version param stays).
--
-- The predicate in SQL mirrors sessionCountsTowardBalance in
-- utils/accounting.js — KEEP IN SYNC. Both must answer the same
-- question for the same inputs, otherwise the trigger and the live
-- amountDue calc disagree (and the audit fires).
--
-- Timezone correctness: JS interprets a session's "D-MMM" + "HH:MM"
-- as wall-clock in the browser's local tz. The trigger does the same
-- using the user's tz from notification_preferences (default
-- America/Mexico_City to match the product's primary market and the
-- notification_preferences default). Without the tz lookup, server
-- (UTC) interpretation would flip the predicate's verdict on
-- sessions whose end was within ±6 hours of the comparison time.

-- ── Spanish-short-month → month index ───────────────────────────────
create or replace function public.spanish_month_idx(mon text)
returns smallint
language sql
immutable
parallel safe
as $$
  select case mon
    when 'Ene' then 1 when 'Feb' then 2 when 'Mar' then 3 when 'Abr' then 4
    when 'May' then 5 when 'Jun' then 6 when 'Jul' then 7 when 'Ago' then 8
    when 'Sep' then 9 when 'Oct' then 10 when 'Nov' then 11 when 'Dic' then 12
  end::smallint;
$$;

-- ── inferYear (matches utils/dates.js::inferYear) ───────────────────
-- Picks (ref_year-1, ref_year, ref_year+1) whose (m, d) is closest to
-- ref (interpreted in the user's tz). Handles Feb 29 in non-leap years
-- via exception swallow.
create or replace function public.infer_short_date_year(
  m smallint, d smallint, ref timestamptz, p_tz text
) returns smallint
language plpgsql
immutable
parallel safe
as $$
declare
  ref_date date := (ref at time zone p_tz)::date;
  ref_year smallint := extract(year from ref_date)::smallint;
  best_year smallint := ref_year;
  best_diff integer := 1000000;
  y smallint;
  cand date;
  diff integer;
begin
  for y in select unnest(array[ref_year - 1, ref_year, ref_year + 1]) loop
    begin
      cand := make_date(y::int, m::int, d::int);
      diff := abs(cand - ref_date);
      if diff < best_diff then
        best_diff := diff;
        best_year := y;
      end if;
    exception when others then
      null; -- e.g. Feb 29 in a non-leap year; skip
    end;
  end loop;
  return best_year;
end;
$$;

-- ── Canonical predicate in SQL (mirror of sessionCountsTowardBalance) ──
-- Returns true when a session contributes to consumed:
--   • status = completed (explicit)
--   • status = charged   (cancel-with-charge — owed immediately, no date gate)
--   • status = scheduled AND (date + time + 1h) ≤ ref
--     (auto-complete equivalent — slot has passed)
create or replace function public.session_counts_at(
  p_status text,
  p_date text,
  p_time text,
  p_tz text,
  ref timestamptz
) returns boolean
language plpgsql
immutable
parallel safe
as $$
declare
  parts text[];
  d_num smallint;
  mon text;
  m smallint;
  yr_suffix text;
  y smallint;
  hh smallint := 0;
  mm smallint := 0;
  tp text[];
  session_end_local timestamp;
  session_end_at timestamptz;
begin
  if p_status = 'completed' or p_status = 'charged' then
    return true;
  end if;
  if p_status <> 'scheduled' then
    return false;
  end if;
  -- Date format constraint (migration 067) guarantees this regex matches.
  -- The optional 3rd capture is the "-YY" suffix.
  parts := regexp_match(
    p_date,
    '^([0-9]+)-(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)(?:-([0-9]{2}))?$'
  );
  if parts is null then return false; end if;
  d_num := parts[1]::smallint;
  mon := parts[2];
  m := public.spanish_month_idx(mon);
  if m is null then return false; end if;
  yr_suffix := parts[3];
  if yr_suffix is not null then
    y := (2000 + yr_suffix::smallint)::smallint;
  else
    y := public.infer_short_date_year(m, d_num, ref, p_tz);
  end if;
  -- Time format constraint (migration 067) guarantees this split works.
  tp := string_to_array(p_time, ':');
  if array_length(tp, 1) >= 2 then
    hh := tp[1]::smallint;
    mm := tp[2]::smallint;
  end if;
  begin
    session_end_local := make_timestamp(y::int, m::int, d_num::int, hh::int, mm::int, 0) + interval '1 hour';
  exception when others then
    return false;
  end;
  -- Reinterpret the naive local time as wall-clock in the user's tz
  -- to land on the correct absolute instant.
  session_end_at := session_end_local at time zone p_tz;
  return ref >= session_end_at;
end;
$$;

-- ── Recalc helper: maintains sessions + billed for one patient ──────
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
  v_sessions integer;
  v_billed integer;
  v_now timestamptz := now();
begin
  select rate, user_id into v_patient_rate, v_user_id
    from patients where id = p_patient_id;
  if v_user_id is null then return; end if; -- patient not found

  -- User's tz from notification_preferences; default Mexico City to
  -- match the product's primary market AND the JS-side parseShortDate
  -- behavior (browser local time, almost always MX for our users).
  select coalesce(timezone, 'America/Mexico_City') into v_tz
    from notification_preferences where user_id = v_user_id;
  if v_tz is null then v_tz := 'America/Mexico_City'; end if;

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

-- ── Trigger: fires after any I/U/D on sessions ──────────────────────
create or replace function public.trg_sessions_recalc_counters()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT') then
    if new.patient_id is not null then
      perform public.recalc_patient_session_counters(new.patient_id);
    end if;
  elsif (tg_op = 'UPDATE') then
    -- Recompute when any predicate input changes. patient_id moving
    -- to a different patient recomputes BOTH sides; otherwise just one.
    if old.patient_id is distinct from new.patient_id then
      if old.patient_id is not null then perform public.recalc_patient_session_counters(old.patient_id); end if;
      if new.patient_id is not null then perform public.recalc_patient_session_counters(new.patient_id); end if;
    elsif old.status is distinct from new.status
       or old.date is distinct from new.date
       or old.time is distinct from new.time
       or old.rate is distinct from new.rate then
      if new.patient_id is not null then perform public.recalc_patient_session_counters(new.patient_id); end if;
    end if;
  elsif (tg_op = 'DELETE') then
    if old.patient_id is not null then perform public.recalc_patient_session_counters(old.patient_id); end if;
  end if;
  return null;
end;
$$;

drop trigger if exists sessions_recalc_counters_after_iud on sessions;
create trigger sessions_recalc_counters_after_iud
after insert or update or delete on sessions
for each row execute function public.trg_sessions_recalc_counters();

-- ── Backfill: recompute counters for every patient ──────────────────
-- After Tier 1 and migration 068's verification both ran clean, this
-- should produce the same numbers the patients table already holds.
-- Idempotent — re-running it is a no-op against a consistent DB.
select public.recalc_patient_session_counters(id) from patients;

-- ── RPC: drop billed-delta parameter (trigger owns billed now) ──────
-- update_session_status_atomic previously accepted p_billed_delta and
-- applied it inline. Now redundant — the trigger fires on the session
-- UPDATE and recomputes billed atomically. The function signature
-- becomes (id, status, reason, expected_version).
--
-- We DROP the prior 5-arg signature before recreating with 4 args.
-- create-or-replace doesn't swap signatures.
drop function if exists public.update_session_status_atomic(uuid, text, text, integer, integer);

create or replace function public.update_session_status_atomic(
  p_session_id uuid,
  p_new_status text,
  p_cancel_reason text,
  p_expected_version integer default null
) returns json
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_session sessions%rowtype;
  v_exists boolean;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if p_new_status not in ('scheduled', 'completed', 'cancelled', 'charged') then
    raise exception 'invalid status: %', p_new_status using errcode = '22023';
  end if;

  update sessions
  set status = p_new_status,
      cancel_reason = case
        when p_new_status in ('scheduled', 'completed') then null
        else p_cancel_reason
      end
  where id = p_session_id
    and user_id = v_user_id
    and (p_expected_version is null or version = p_expected_version)
  returning * into v_session;

  if not found then
    select exists(select 1 from sessions where id = p_session_id and user_id = v_user_id)
      into v_exists;
    if v_exists and p_expected_version is not null then
      raise exception 'session version conflict' using errcode = '40001';
    end if;
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  -- patient.billed and patient.sessions are maintained by
  -- trg_sessions_recalc_counters which fired on the UPDATE above.
  -- Return the session row so the client can sync local state with the
  -- committed shape (cancel_reason normalized server-side).
  return json_build_object('session', row_to_json(v_session));
end;
$$;
