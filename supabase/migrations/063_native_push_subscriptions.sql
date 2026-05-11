-- Native push (iOS APNs, Android FCM) alongside existing Web Push.
--
-- Today push_subscriptions stores a Web Push subscription:
--   { endpoint: 'https://fcm.googleapis.com/...', p256dh, auth }
-- Native tokens have a different shape — a single opaque token string
-- per device, with no encryption keys (the platform's push service
-- handles encryption). The simplest mapping is:
--   • endpoint  = the FCM/APNs token (still globally unique per device,
--                 still the natural primary key for dedupe).
--   • platform  = 'web' | 'ios' | 'android' (NEW) to disambiguate.
--   • p256dh + auth = nullable, populated only for web rows.
--
-- This keeps web rows untouched (default 'web' backfills existing data)
-- while letting native code paths register tokens without parallel
-- tables or a wholesale rewrite of the push pipeline.
--
-- The `channel` column on sent_reminders already exists (added in
-- migration 019_whatsapp_reminders.sql for WhatsApp dedupe). Native
-- sends will write channel='ios' or channel='android'; web push keeps
-- its existing channel='push' value.

alter table public.push_subscriptions
  add column if not exists platform text not null default 'web';

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_platform_check;

alter table public.push_subscriptions
  add constraint push_subscriptions_platform_check
  check (platform in ('web', 'ios', 'android'));

alter table public.push_subscriptions
  alter column p256dh drop not null;

alter table public.push_subscriptions
  alter column auth drop not null;

-- Row-shape invariant: web rows must keep p256dh + auth (the VAPID
-- payload encryption needs them); native rows must NOT have them. This
-- stops a future code change from inserting an inconsistent row that
-- the fan-out logic in api/send-session-reminders.js would then crash on.
alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_shape_check;

alter table public.push_subscriptions
  add constraint push_subscriptions_shape_check
  check (
    (platform = 'web' and p256dh is not null and auth is not null)
    or (platform in ('ios', 'android') and p256dh is null and auth is null)
  );

create index if not exists idx_push_subscriptions_platform_user
  on public.push_subscriptions(user_id, platform);
