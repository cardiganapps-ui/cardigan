-- 065 — optimistic locking on sessions
--
-- Threat model: a single therapist can have multiple tabs / devices open,
-- and the patient portal can also trigger session writes (reschedule,
-- cancel) via /api/patient-*. If two of those paths read the same row at
-- the same time and write concurrently, the second writer silently
-- clobbers the first. The Prime Directive on financial integrity forbids
-- silent overwrites of money-affecting state.
--
-- Pattern: a monotonically increasing `version` integer per row. Writers
-- carry the version they think they're updating; the database rejects the
-- update if it doesn't match. The auto-bump trigger guarantees every
-- successful UPDATE advances the counter so no caller can forget.
--
-- Scope of this migration: SESSIONS ONLY. Patients and payments are
-- intentionally out of scope:
--   • patients.{billed,paid,sessions} are denormalized counters that the
--     status-update RPC (064) and recalcPatientCounters mutate as a side
--     effect of session/payment writes. Adding a version check there would
--     cause spurious conflicts when two unrelated session writes race on
--     the same patient row, even though their counter deltas commute.
--   • payments are typically single-author single-entry — every row is
--     inserted once and almost never edited. The conflict surface is
--     minimal.
--
-- If a future scenario surfaces payment conflicts (e.g. patient portal
-- self-pay split with the therapist editing), follow the same pattern:
-- add version column + trigger, surface conflict in the hook.

alter table sessions add column if not exists version integer not null default 1;

create or replace function public.bump_version_on_update()
returns trigger
language plpgsql
as $$
begin
  -- Auto-increment unless the caller is explicitly setting version (which
  -- is allowed for tools like the audit / backfill scripts that want to
  -- preserve the value). The common case — every hook UPDATE — does not
  -- touch version, so OLD.version = NEW.version is the typical branch.
  if NEW.version is null or NEW.version = OLD.version then
    NEW.version := OLD.version + 1;
  end if;
  return NEW;
end;
$$;

drop trigger if exists sessions_bump_version on sessions;
create trigger sessions_bump_version
  before update on sessions
  for each row execute function public.bump_version_on_update();

-- Update the status RPC (migration 064) to optionally validate a
-- caller-supplied version. Passing null (the default) skips the check,
-- preserving backward compatibility with any in-flight clients between
-- deploy and full rollout.
--
-- On version mismatch we raise SQLSTATE 40001 (serialization failure),
-- which the JS caller pattern-matches against to surface a "this row was
-- edited elsewhere; refreshing" toast and re-fetch. We deliberately use
-- a distinct code from P0002 (not found) so the caller can tell a stale
-- version apart from an actual missing row.
--
-- We DROP the prior 4-arg overload before recreating with the new
-- signature. `create or replace function` only replaces functions with
-- the same argument list; without the drop, both overloads coexist and
-- PostgREST has to disambiguate by argument names, which it does not do
-- reliably across clients.
drop function if exists public.update_session_status_atomic(uuid, text, text, integer);

create or replace function public.update_session_status_atomic(
  p_session_id uuid,
  p_new_status text,
  p_cancel_reason text,
  p_billed_delta integer,
  p_expected_version integer default null
) returns json
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_session sessions%rowtype;
  v_billed_after integer;
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
    -- Distinguish "doesn't exist / not mine" from "version stale" so the
    -- client can react differently (refresh vs. give up).
    select exists(select 1 from sessions where id = p_session_id and user_id = v_user_id)
      into v_exists;
    if v_exists and p_expected_version is not null then
      raise exception 'session version conflict' using errcode = '40001';
    end if;
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  if p_billed_delta != 0 and v_session.patient_id is not null then
    update patients
    set billed = greatest(0, billed + p_billed_delta)
    where id = v_session.patient_id
      and user_id = v_user_id
    returning billed into v_billed_after;
  end if;

  return json_build_object(
    'session', row_to_json(v_session),
    'billed', v_billed_after
  );
end;
$$;
