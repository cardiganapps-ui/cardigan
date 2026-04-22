-- 012_resend_events.sql
--
-- Table for capturing Resend webhook events (api/resend-webhook.js).
-- Lets us measure real send → delivered timings after the fact when
-- a user reports slow email delivery.
--
-- Writes: only the service-role client via api/resend-webhook.js.
-- Reads: admin-only (RLS check against is_admin()).

create table if not exists public.resend_events (
  id                  bigserial primary key,
  email_id            uuid,
  type                text not null,
  event_at            timestamptz not null,
  email_created_at    timestamptz,
  to_addr             text,
  subject             text,
  seconds_since_send  double precision,
  raw                 jsonb,
  inserted_at         timestamptz not null default now()
);

-- Index by email_id so we can pull the full timeline for a specific
-- email quickly when diagnosing.
create index if not exists resend_events_email_id_idx
  on public.resend_events (email_id);

-- Index by (type, event_at) for "show me all bounces this week" style
-- queries.
create index if not exists resend_events_type_event_at_idx
  on public.resend_events (type, event_at desc);

-- RLS: block all client access. The service-role client bypasses RLS
-- (used only by api/resend-webhook.js). Admin reads go through an
-- explicit policy that checks is_admin().
alter table public.resend_events enable row level security;

drop policy if exists "admin can read resend_events" on public.resend_events;
create policy "admin can read resend_events"
  on public.resend_events
  for select
  to authenticated
  using (public.is_admin());

-- No insert/update/delete policies — only the service-role client
-- (api/resend-webhook.js) writes here, and it bypasses RLS.
