-- Per-conversion referral ledger. Every time a referred user pays
-- their first invoice, we insert one row here capturing inviter,
-- invitee, amount credited, and timestamp.
--
-- Why not just bump `referral_rewards_count` on user_subscriptions?
-- The denormalized counter still exists for fast reads, but a count
-- alone can't power the "Quién has invitado" leaderboard or the
-- per-inviter cap that rejects > N credits in a rolling window.
--
-- Source of truth: this table. user_subscriptions.referral_rewards_count
-- is now a derived counter we keep in sync from the webhook for
-- backwards compat with the existing UI reads.

create table if not exists referral_credits (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references auth.users(id) on delete cascade,
  invitee_user_id uuid not null references auth.users(id) on delete cascade,
  -- MXN cents matching Stripe semantics. One free month of Pro at the
  -- monthly price at the time of the credit — the column captures
  -- the exact amount so a future price change doesn't retroactively
  -- distort the ledger.
  amount_cents integer not null,
  -- The Stripe invoice that triggered this credit, for reconciliation.
  invoice_id text,
  credited_at timestamptz not null default now(),
  -- One credit per (inviter, invitee) pair. Re-delivered invoice.paid
  -- webhooks don't double-credit even if upstream dedupe slips.
  unique (inviter_user_id, invitee_user_id)
);

create index if not exists idx_referral_credits_inviter
  on referral_credits(inviter_user_id, credited_at desc);
create index if not exists idx_referral_credits_invitee
  on referral_credits(invitee_user_id);

alter table referral_credits enable row level security;

-- Owner sees their own credit history (powers the leaderboard).
create policy "Users read own referral credits as inviter"
  on referral_credits for select
  using (auth.uid() = inviter_user_id);

create policy "Admin reads all referral credits"
  on referral_credits for select
  using (is_admin());

-- Service-role only writes (api/stripe-webhook.js).
