-- 060_reschedule_requests.sql
--
-- Patient-initiated reschedule requests. Until a therapist responds
-- (in-app or via email link), the request lives here without touching
-- the underlying sessions row — same shape as cancel/charge but
-- gated on therapist consent rather than self-serve.
--
-- One pending request per session at a time. The partial unique
-- index `uniq_one_pending_per_session` enforces it; new requests from
-- the same patient must withdraw the previous (the endpoint does
-- this server-side).
--
-- Tokens (approve_token / reject_token) are 32-byte CSPRNG strings
-- the email-link path uses to authenticate without a JWT — same
-- pattern as user_calendar_tokens. Cleared after the request is
-- resolved so a leaked email link can't replay against a settled
-- request. Unique index supports the public lookup endpoint.

create table if not exists session_reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  -- Therapist user_id (denormalized from sessions.user_id so we can
  -- scope RLS without joining).
  user_id uuid not null,
  patient_id uuid not null references patients(id) on delete cascade,
  -- The auth user that created the request (the patient's auth row).
  -- Audit only — RLS uses user_id (therapist) and patient_id chains.
  submitted_by uuid not null,

  -- Snapshot of the original date+time at request creation. Lets us
  -- show "from X to Y" in emails / UI without joining sessions and
  -- worrying about concurrent edits to the row.
  original_date text not null,
  original_time text not null,
  -- Proposed new date+time (D-MMM + HH:MM, same format as sessions).
  proposed_date text not null,
  proposed_time text not null,

  patient_note text,
  therapist_note text,

  status text not null default 'pending'
    check (status in ('pending','accepted','rejected','withdrawn','expired')),
  resolved_at timestamptz,
  resolved_by text
    check (resolved_by is null
      or resolved_by in ('therapist_app','therapist_email','patient_withdraw','auto_expire')),

  -- Auto-set by the endpoint to 1h before the earlier of (original,
  -- proposed) so the request can't outlive its own context. Cron
  -- sweeps rows where status='pending' AND expires_at < now().
  expires_at timestamptz not null,

  -- Email-link tokens — null after first use OR when the request
  -- resolves through any path (revokes any unsent leaked link).
  approve_token text,
  reject_token text,

  created_at timestamptz default now()
);

-- One pending request per session — partial unique. Lets historical
-- accepted/rejected/withdrawn rows pile up for the audit trail
-- without conflicting with a new pending one on the same session.
create unique index if not exists uniq_one_pending_per_session
  on session_reschedule_requests(session_id)
  where status = 'pending';

-- Token lookups for the public email-link endpoint. UNIQUE on the
-- token itself so two different requests can't accidentally share
-- one (the CSPRNG makes the collision astronomically unlikely, but
-- the constraint is cheap insurance).
create unique index if not exists uniq_reschedule_approve_token
  on session_reschedule_requests(approve_token)
  where approve_token is not null;
create unique index if not exists uniq_reschedule_reject_token
  on session_reschedule_requests(reject_token)
  where reject_token is not null;

-- Cron sweep + therapist-app banner queries.
create index if not exists idx_reschedule_pending
  on session_reschedule_requests(user_id, status, expires_at)
  where status = 'pending';

alter table session_reschedule_requests enable row level security;

-- Therapist sees their own (matches sessions.user_id ownership).
create policy "Therapist reads own reschedule requests"
  on session_reschedule_requests for select
  using (auth.uid() = user_id);

-- Patient sees requests filed against patient rows linked to them.
-- Mirrors the existing `patients` RLS chain (patients.patient_user_id).
create policy "Patient reads requests for own patient row"
  on session_reschedule_requests for select
  using (exists (
    select 1 from patients p
    where p.id = session_reschedule_requests.patient_id
      and p.patient_user_id = auth.uid()
  ));

create policy "Admin reads all reschedule requests"
  on session_reschedule_requests for select using (is_admin());

-- All writes go through service-role via /api/* endpoints. No INSERT/
-- UPDATE/DELETE policies on purpose: the endpoints are the bottleneck
-- for ownership checks, race-safe state transitions, and token
-- lifecycle. Adding any user-facing write policy here would let the
-- patient or therapist app skip those guards.
