-- 061_reschedule_session_invariants.sql
--
-- Two related invariants the application layer was already trying to
-- enforce, now backed by the DB so they hold under any concurrent
-- write — including the therapist's own client-side rescheduleSession
-- action that doesn't go through the request flow.
--
-- (1) Slot uniqueness for scheduled sessions
-- =============================================
-- Partial unique index on (user_id, date, time) WHERE status='scheduled'.
-- Prevents two scheduled sessions from sharing the same therapist's
-- slot — both the patient-reschedule endpoint AND the therapist's
-- agenda do a "is this slot taken?" SELECT followed by a write,
-- which has a TOCTOU race window. The index closes that window.
--
-- Cancelled / completed / charged sessions are intentionally
-- excluded — historical or unbooked slots can collide without
-- consequence; the constraint applies only to live bookings.
--
-- (2) Auto-withdraw pending reschedule requests when the session moves
-- ====================================================================
-- When the therapist drags a session in their agenda (or any other
-- code path mutates sessions.date / sessions.time), any pending
-- session_reschedule_request on that session becomes stale — the
-- "from X to Y" the request stored no longer matches the session's
-- current state. applyAccept's stale-detection (added in the prior
-- commit) catches this and refuses cleanly, but the request still
-- LIVES in the DB and shows up in the therapist's pending banner.
--
-- This trigger withdraws those stale requests at the moment the
-- session moves, so the banner clears and no one tries to act on a
-- request whose context has shifted.
--
-- The trigger fires AFTER UPDATE OF date, time — Postgres only fires
-- the trigger when those columns are actually changed, so unrelated
-- session updates (status flips, rate edits, modality changes) don't
-- trigger needless writes against session_reschedule_requests.
--
-- Interaction with applyAccept: applyAccept itself updates session
-- date/time, which would fire this trigger and withdraw the request
-- it's about to mark accepted. The applyAccept-side request UPDATE
-- doesn't gate on status='pending', so it cleanly overwrites the
-- transient withdrawn → accepted. End state is correct (accepted).
-- A brief in-flight read between the two writes could see "withdrawn",
-- but that's flicker, not a stable visible state.

create unique index if not exists uniq_sessions_user_slot
  on sessions(user_id, date, time)
  where status = 'scheduled';

-- Add 'auto_session_moved' to the resolved_by enum so the trigger
-- can stamp it when it fires. Drop and re-add the constraint with
-- the expanded set.
alter table session_reschedule_requests
  drop constraint if exists session_reschedule_requests_resolved_by_check;
alter table session_reschedule_requests
  add constraint session_reschedule_requests_resolved_by_check
  check (resolved_by is null or resolved_by in (
    'therapist_app','therapist_email','patient_withdraw',
    'auto_expire','auto_session_moved'
  ));

create or replace function withdraw_reschedule_requests_on_move()
returns trigger
language plpgsql
as $$
begin
  if old.date is distinct from new.date or old.time is distinct from new.time then
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

drop trigger if exists sessions_withdraw_reschedule_on_move on sessions;
create trigger sessions_withdraw_reschedule_on_move
after update of date, time on sessions
for each row
execute function withdraw_reschedule_requests_on_move();
