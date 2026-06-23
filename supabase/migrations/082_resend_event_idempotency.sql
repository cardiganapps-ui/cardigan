-- 082_resend_event_idempotency.sql
--
-- Make the Resend webhook log idempotent. Resend (like all webhook
-- providers) delivers at-least-once, so a retry re-POSTs an event we've
-- already recorded. Until now api/resend-webhook.ts did a bare INSERT,
-- so a redelivery appended a DUPLICATE row to resend_events, polluting
-- the delivery-timing diagnostics the table exists for.
--
-- Resend doesn't send a single opaque event id, but the tuple
-- (email_id, type, event_at) uniquely identifies a delivery event
-- (`type` + `event_at` are NOT NULL; email_id may be null for non-email
-- events, coalesced to ''). We materialize that as `event_uid` and put a
-- unique index on it; the handler switches to insert + skip-on-23505,
-- mirroring the Stripe webhook's stripe_webhook_events dedupe.
--
-- Apply, then regenerate the schema snapshot:
--   node --env-file=.env.local scripts/schema-snapshot.mjs --update

alter table public.resend_events
  add column if not exists event_uid text;

-- Backfill existing rows from the same composite the handler will write.
update public.resend_events
  set event_uid = coalesce(email_id::text, '') || '|' || coalesce(type, '') || '|' || coalesce(event_at::text, '')
  where event_uid is null;

-- Collapse any duplicates that the pre-idempotency INSERT already
-- created, keeping the earliest row per event_uid, so the unique index
-- below can be built.
delete from public.resend_events a
  using public.resend_events b
  where a.event_uid = b.event_uid
    and a.id > b.id;

create unique index if not exists uniq_resend_events_event_uid
  on public.resend_events (event_uid);
