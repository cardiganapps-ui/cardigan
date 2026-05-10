-- 062_reschedule_trigger_status_changes.sql
--
-- Extends the trigger from migration 061 to ALSO withdraw pending
-- reschedule requests when the underlying session's status transitions
-- out of 'scheduled' (cancelled / completed / charged). The original
-- trigger only fired on date/time changes — it left a hole where a
-- session cancellation or charge would leave the patient's pending
-- request stranded in the therapist's banner forever, and accepting
-- it would race-loss with a confusing error.
--
-- New predicate combines both cases: any UPDATE that either
-- (a) actually moves the session (date or time changed) OR
-- (b) takes the session out of the scheduled state
-- now triggers the withdrawal of any pending request on it.
--
-- The trigger now fires on AFTER UPDATE in general (not OF date,time)
-- so the function gets a chance to inspect status. The function's
-- predicate keeps the early-out for unrelated updates (rate, modality,
-- session_type) so we don't generate write traffic for changes that
-- don't invalidate pending requests.

create or replace function withdraw_reschedule_requests_on_move()
returns trigger
language plpgsql
as $$
begin
  if (old.date is distinct from new.date)
     or (old.time is distinct from new.time)
     or (old.status = 'scheduled' and new.status is distinct from 'scheduled') then
    update session_reschedule_requests
       set status = 'withdrawn',
           resolved_at = now(),
           resolved_by = 'auto_session_moved',
           approve_token = null,
           reject_token = null
     where session_id = new.id
       and status = 'pending';
  end if;
  return new;
end;
$$;

-- Re-create the trigger to fire on any UPDATE (so the function sees
-- status changes too). The function's predicate gates the actual
-- write so we don't pile up needless traffic.
drop trigger if exists sessions_withdraw_reschedule_on_move on sessions;
create trigger sessions_withdraw_reschedule_on_move
after update on sessions
for each row
execute function withdraw_reschedule_requests_on_move();
