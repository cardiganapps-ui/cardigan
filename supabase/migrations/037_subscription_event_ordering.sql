-- Webhook event-ordering guard for user_subscriptions.
--
-- Stripe webhooks are "at-least-once" and not strictly ordered. Two
-- events for the same customer can race, and a stale older event
-- delivered after a newer one will clobber the row's correct state if
-- the handler just blindly applies the latest payload.
--
-- Concretely: when a user retries a checkout, /api/stripe-create-
-- subscription cancels the prior incomplete sub and creates a fresh
-- one. Stripe fires both `customer.subscription.deleted` (old) and
-- `customer.subscription.created` (new). If the deleted event lands
-- second, it overwrites the row's just-applied "trialing" state with
-- the old sub's "canceled" snapshot.
--
-- Fix: track the event.created timestamp of the most recent event
-- the webhook has applied, and skip events older than that. The
-- handler does the comparison in JS; this column is the persistent
-- ledger entry.
--
-- A null value means "no event has been applied yet" — the first
-- event always wins. /api/stripe-sync also stamps this column to
-- `now()` so the live-pulled snapshot wins against any in-flight
-- webhooks for older states.

alter table user_subscriptions
  add column if not exists last_stripe_event_at timestamptz;
