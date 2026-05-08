-- ── 055_connect_last_event_at.sql ──
-- The /api/stripe-connect-status endpoint live-fetches Connect
-- account state from Stripe and writes any delta back to the DB so
-- the therapist's UI reflects fresh state on first render after
-- onboarding return. Combined with the webhook also writing on
-- account.updated, there's a race: a slightly-stale Stripe API
-- response (a few seconds lag) can land AFTER a newer webhook event
-- and overwrite the correct state with stale state.
--
-- Mirroring the user_subscriptions.last_stripe_event_at pattern,
-- this column lets the status endpoint skip overwriting when the
-- DB row was advanced by a more recent webhook. Both writers stamp
-- this column with the event/fetch timestamp and only proceed when
-- their timestamp is strictly newer than what's there.

alter table therapist_connect_accounts
  add column if not exists last_event_at timestamptz;
