-- Trial extension column. Activation milestones grant +N days on the
-- natural 30-day trial — this is the additive-only counter the
-- useSubscription hook adds to created_at + 30d to compute the
-- effective trial end.
--
-- Granted via /api/grant-trial-extension after the client confirms
-- the user just completed all 4 ActivationChecklist steps. The
-- endpoint is idempotency-keyed by reason so a refresh + re-tap
-- can't stack the bonus.
--
-- Lives on user_subscriptions because it's the row already in scope
-- for every billing read (no extra round-trip from useSubscription).

alter table user_subscriptions
  add column if not exists trial_extension_days integer not null default 0;

-- Per-reason audit so we can prove WHY a given extension was granted.
-- 'activation_complete' is the only reason wired today; admin grants
-- and post-launch promos can add new reasons here.
create table if not exists trial_extensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  days integer not null,
  reason text not null,
  granted_at timestamptz not null default now(),
  -- One grant per (user, reason) — idempotency guard. The endpoint
  -- relies on a unique violation to no-op a duplicate request.
  unique (user_id, reason)
);

alter table trial_extensions enable row level security;

create policy "Users read own trial extensions"
  on trial_extensions for select
  using (auth.uid() = user_id);

create policy "Admin reads all trial extensions"
  on trial_extensions for select
  using (is_admin());
