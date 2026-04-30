-- Lifecycle email dedupe ledger.
--
-- We send a small set of one-off transactional emails outside the
-- session-reminder + auth flows: trial-day-3 onboarding nudge, trial-
-- day-25 reminder, trial-day-37 winback, failed-payment recovery.
-- Each must fire at most once per (user, kind) — our scheduler runs
-- every 5 minutes and re-evaluates the cohort each tick, so without
-- a dedupe row we'd spam users.
--
-- Source of truth lives here in the DB rather than in client state
-- because the same user can switch devices and the cron has no
-- per-user memory.

create table if not exists lifecycle_emails (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- One of: 'trial_day_3', 'trial_day_25', 'trial_winback_day_37',
  -- 'payment_failed'. Free text rather than an enum so adding a new
  -- kind is a code-only change.
  kind text not null,
  sent_at timestamptz not null default now(),
  -- Optional Resend delivery id so we can chase a specific send if a
  -- user reports never receiving the mail.
  resend_id text,
  primary key (user_id, kind)
);

create index if not exists idx_lifecycle_emails_kind_sent
  on lifecycle_emails(kind, sent_at desc);

alter table lifecycle_emails enable row level security;

-- Owner can read their own send history (for "we already emailed you
-- about this" flavoring in the UI; not currently surfaced but cheap).
create policy "Users read own lifecycle emails"
  on lifecycle_emails for select
  using (auth.uid() = user_id);

create policy "Admin reads lifecycle emails"
  on lifecycle_emails for select
  using (is_admin());

-- No INSERT / UPDATE / DELETE policies for the user role: writes are
-- exclusively from cron + webhook handlers via the service-role client.
