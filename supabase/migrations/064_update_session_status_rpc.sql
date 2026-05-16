-- 064 — update_session_status_atomic: single-RPC session+patient update
--
-- Today's updateSessionStatus does two sequential writes (sessions row,
-- then patients row) with a recalcPatientCounters fallback if the
-- patient write fails after the session write succeeds. Functionally
-- correct, but two round-trips and a fallback path that's hard to
-- reason about.
--
-- This function does both in one transaction. The JS caller computes
-- the billed delta using the canonical predicate
-- (utils/accounting.js::sessionCountsTowardBalance) and passes it in.
-- The function applies the new status + cancel_reason on the session
-- row and the delta on the patient row, all atomically — both writes
-- succeed or both fail. No more recalc-fallback needed for this path.
--
-- SECURITY INVOKER + auth.uid() match → RLS does the heavy lifting.
-- Forces the caller to own both rows via the existing per-table
-- policies; the function never reaches across users.
--
-- cancel_reason cleanup mirrors the JS code:
--   • SCHEDULED / COMPLETED → null (reason no longer applies)
--   • CANCELLED / CHARGED   → whatever the caller passed (may be null
--                              if they didn't supply one)

create or replace function public.update_session_status_atomic(
  p_session_id uuid,
  p_new_status text,
  p_cancel_reason text,
  p_billed_delta integer
) returns json
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_session sessions%rowtype;
  v_billed_after integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- Defensive check: the SESSION_STATUS check constraint will also
  -- catch bad values, but failing here with a clear message is friendlier
  -- than a constraint-violation error reaching the client.
  if p_new_status not in ('scheduled', 'completed', 'cancelled', 'charged') then
    raise exception 'invalid status: %', p_new_status using errcode = '22023';
  end if;

  -- Update session row. RLS ensures user_id = auth.uid().
  update sessions
  set status = p_new_status,
      cancel_reason = case
        when p_new_status in ('scheduled', 'completed') then null
        else p_cancel_reason
      end
  where id = p_session_id
    and user_id = v_user_id
  returning * into v_session;

  if not found then
    -- RLS may also reject; this branch catches a stale id or another
    -- user's row attempting access.
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  -- Apply billed delta if any. JS caller derives this from the
  -- canonical predicate (sessionCountsTowardBalance before/after); we
  -- trust it here — the function intentionally has no copy of the
  -- predicate to maintain. Clamp at zero so a stale local-state copy
  -- of patient.billed can never push the stored value negative.
  if p_billed_delta != 0 and v_session.patient_id is not null then
    update patients
    set billed = greatest(0, billed + p_billed_delta)
    where id = v_session.patient_id
      and user_id = v_user_id
    returning billed into v_billed_after;
    -- If the patient row went missing (orphaned session?), the update
    -- silently no-ops. Don't fail the session update for it — the
    -- accounting integrity is best-effort when the patient row is
    -- already gone.
  end if;

  -- Return the updated session row so the client can sync local state
  -- with the committed shape (cancel_reason normalized server-side).
  return json_build_object(
    'session', row_to_json(v_session),
    'billed', v_billed_after
  );
end;
$$;
