-- Per-endpoint rate limiting for sensitive /api routes.
--
-- Vercel Firewall already caps /api/* at 120 req/min/IP, but that's a
-- coarse blanket. This table powers a finer per-endpoint, per-key
-- (typically user_id) limit applied inside the handler — for surfaces
-- where Stripe / Resend / our own DB cost real money on each call.
--
-- Sliding-window count: every call inserts a row, the limiter reads
-- count-since-window-start, allows or rejects. Rows older than the
-- max window age are eligible for purge by the same daily cron that
-- purges stripe_webhook_events.

create table if not exists rate_limits (
  -- Composite key — endpoint name (e.g. "stripe-checkout") plus the
  -- caller bucket (user_id, anon-IP, etc.). Multiple rows per key
  -- accumulate the count; the limiter reads count(*) since window
  -- start.
  endpoint text not null,
  bucket   text not null,
  hit_at   timestamptz not null default now(),
  primary key (endpoint, bucket, hit_at)
);

create index if not exists idx_rate_limits_endpoint_bucket
  on rate_limits(endpoint, bucket, hit_at desc);

-- Service-role only. RLS is on so a probing client can't insert
-- spurious rows or read other users' counts.
alter table rate_limits enable row level security;

-- Daily-purge marker. Reuses the cron_state pattern from migration
-- 032 so the existing piggy-back cron picks this up without new
-- scheduling.
insert into cron_state (job, last_run_at) values
  ('purge_rate_limits', null)
on conflict (job) do nothing;
