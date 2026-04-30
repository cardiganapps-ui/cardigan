-- Stripe SaaS subscriptions (Cardigan Pro — $299 MXN / month).
--
-- This is the SaaS-billing layer (therapist pays Cardigan), entirely
-- separate from patient payments / sessions. NEVER cross-reference
-- patient `payments` rows from this table — those are the therapist's
-- own bookkeeping and have nothing to do with their Cardigan plan.
--
-- One row per user. Created lazily: we INSERT (with stripe_customer_id)
-- the moment the user clicks "Suscribirme" and we mint a Stripe customer.
-- All subsequent state transitions are driven by the Stripe webhook —
-- the client never writes to this table directly.
--
-- RLS: the user can READ their own row (status badge in Settings). Only
-- the service-role client (in api/stripe-webhook.js) can write. There is
-- no UPDATE or INSERT policy for the user role on purpose — drift between
-- Stripe and our DB has to be reconciled by the webhook, never by trust.

create table if not exists user_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Stripe customer id is mandatory once the row exists; we mint the
  -- customer before inserting. Indexed because the webhook looks up by
  -- this id (no user_id in the Stripe event payload otherwise).
  stripe_customer_id text not null unique,
  -- Subscription id is nullable: a user can have a customer record (e.g.
  -- they started checkout but abandoned it) without an active sub.
  stripe_subscription_id text unique,
  stripe_price_id text,
  -- Mirrors Stripe statuses: trialing, active, past_due, canceled,
  -- unpaid, incomplete, incomplete_expired, paused. We don't enforce a
  -- check constraint because Stripe may add new statuses in the future
  -- and we'd rather record an unknown value than reject the webhook.
  status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  trial_end timestamptz,
  -- Latest invoice url so the UI can surface "Ver factura" when there's
  -- a pending or recent payment to chase.
  latest_invoice_id text,
  hosted_invoice_url text,
  -- Stripe payment_method id attached as the subscription's default.
  -- NULL for any incomplete sub where the user opened the payment
  -- sheet but never confirmed the card — those orphans get a
  -- `trialing` status from Stripe (because of `trial_end`) but
  -- aren't real customers. The `isPro` gate explicitly requires
  -- this field to be populated when status is `trialing`, otherwise
  -- non-paying users would get Pro features.
  default_payment_method text,
  -- Admin-granted complimentary access. When true, the access gate
  -- treats this user as "active" regardless of Stripe state, and
  -- /api/stripe-checkout refuses to start a paid subscription. Used
  -- for early-access friends, pilot users, and the admin's own
  -- account. Toggled via /api/admin-grant-comp (admin-only).
  comp_granted boolean default false,
  comp_granted_at timestamptz,
  comp_granted_by text,
  comp_reason text,
  -- ── Referrals ──
  -- This user's invite code — generated lazily on first visit to the
  -- Suscripción settings panel. 8-char alphanumeric, unique. Sharing
  -- the code with new users earns the original holder a free month of
  -- Cardigan Pro (issued as a Stripe customer-balance credit) every
  -- time an invitee converts to a paid subscription.
  referral_code text unique,
  -- The code this user came in with, if any. Stamped at /api/stripe-
  -- checkout time (we accept the code in the request body, validate
  -- it points at another user, and persist here). Stripe is also
  -- told via subscription metadata so the webhook can find it on
  -- invoice.paid even if the DB lookup races.
  referred_by text,
  -- Set the moment the inviter has been credited for THIS row's first
  -- paid invoice. Idempotency guard — Stripe re-fires invoice.paid for
  -- subsequent monthly invoices, and we mustn't credit the inviter on
  -- every renewal.
  referral_reward_credited_at timestamptz,
  -- Number of times this user has earned a referral reward (i.e. the
  -- count of distinct invitees who became paid customers using their
  -- code). Surfaced in the Settings panel.
  referral_rewards_count integer not null default 0,
  -- Stripe-side credit that hasn't been written to a customer balance
  -- yet — accumulated when the inviter doesn't have a real Stripe
  -- customer at reward time (e.g. still in trial). Drained at the
  -- inviter's next /api/stripe-checkout into customer.balance, where
  -- Stripe auto-applies it to the first invoice. Stored in MXN cents
  -- to match Stripe's amount semantics.
  pending_credit_amount_cents integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_user_subscriptions_customer on user_subscriptions(stripe_customer_id);
create index if not exists idx_user_subscriptions_status on user_subscriptions(status);
create index if not exists idx_user_subscriptions_comp_granted on user_subscriptions(comp_granted) where comp_granted = true;
create index if not exists idx_user_subscriptions_referral_code on user_subscriptions(referral_code) where referral_code is not null;
create index if not exists idx_user_subscriptions_referred_by on user_subscriptions(referred_by) where referred_by is not null;

alter table user_subscriptions enable row level security;

-- Owner can read their own row.
create policy "Users read own subscription"
  on user_subscriptions for select
  using (auth.uid() = user_id);

-- Admin can read every row (for the AdminPanel viewer).
create policy "Admin reads all subscriptions"
  on user_subscriptions for select
  using (is_admin());

-- No INSERT / UPDATE / DELETE policies for the user role: writes are
-- exclusively through the service-role client in api/stripe-webhook.js.
-- The service role bypasses RLS so it doesn't need a policy.

-- ── Webhook event idempotency log ─────────────────────────────────────
-- Stripe will retry webhooks on non-2xx, and "at-least-once" semantics
-- mean a duplicate is the norm, not the exception. We dedupe by event id
-- before doing any side-effecting work in the handler. Rows older than
-- 30 days can be pruned (a follow-up cron); for now we keep them all.
create table if not exists stripe_webhook_events (
  event_id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  -- Optional: capture the entire event for forensic replay if Stripe
  -- ever asks "what did you receive at 3am?". Compresses well.
  payload jsonb
);

create index if not exists idx_stripe_webhook_events_received_at on stripe_webhook_events(received_at desc);

alter table stripe_webhook_events enable row level security;

-- Admin-only read; the service role bypasses RLS for inserts.
create policy "Admin reads webhook events"
  on stripe_webhook_events for select
  using (is_admin());

-- ── deleteUserCascade ──────────────────────────────────────────────────
-- user_subscriptions cascades automatically via the FK to auth.users
-- (on delete cascade), so the existing api/_admin.js::deleteUserCascade
-- doesn't need to be amended. The Stripe-side customer is NOT deleted
-- here — that's a manual cleanup step in the Stripe dashboard. If you
-- want automated Stripe-side cleanup on account deletion, add a
-- `stripe.customers.del(stripe_customer_id)` call to deleteUserCascade
-- (best-effort, swallow errors so a Stripe outage can't block deletion).
