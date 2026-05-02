-- Capture Stripe's `cancel_at` timestamp on user_subscriptions.
--
-- Stripe represents "scheduled cancellation" two different ways
-- depending on Billing Portal configuration:
--
--   1. `cancel_at_period_end: true` (boolean) — cancel at the end of
--      the current billing period.
--   2. `cancel_at: <unix>` (timestamp) — cancel at a specific moment.
--
-- We were storing only #1 and ignoring #2. A real-world test caught
-- this: the user clicked "Cancel" in the Billing Portal during their
-- trial, Stripe fired `customer.subscription.updated` with
-- `cancel_at: <trial_end_unix>` and `cancel_at_period_end: false`,
-- our webhook persisted only the boolean (still false), and the UI
-- reported "Activa" indefinitely even though the sub was scheduled
-- to terminate.
--
-- Adding `cancel_at` so the webhook captures the timestamp variant.
-- The UI's "is this sub winding down?" check OR's the boolean and
-- this column to cover both.

alter table user_subscriptions
  add column if not exists cancel_at timestamptz;
