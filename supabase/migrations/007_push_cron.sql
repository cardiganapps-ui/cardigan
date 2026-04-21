-- Schedule the push notification cron job using pg_cron + pg_net.
-- This calls the Vercel API endpoint every 5 minutes to check for
-- upcoming sessions and send push reminders.
--
-- Prerequisites:
--   1. Enable pg_cron and pg_net extensions in Supabase Dashboard
--      (Database → Extensions → search for each and enable)
--   2. Set the cron secret as a database config parameter:
--      ALTER DATABASE postgres SET app.cron_secret = 'your-secret-here';
--   3. Set the same CRON_SECRET in Vercel environment variables.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Schedule: call the reminder endpoint every 5 minutes.
--
-- IMPORTANT: use the canonical `cardigan-app.vercel.app` host, NOT
-- the auto-assigned `cardigan-fawn.vercel.app` alias. The fawn URL
-- 307-redirects to the canonical deployment and cross-origin
-- redirects strip the Authorization header per the Fetch spec, so
-- the endpoint silently returns 401 and no reminders are sent.
-- (Discovered in production — reminders were queued by pg_net but
-- never actually delivered until the host was switched.)
select cron.schedule(
  'send-session-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://cardigan-app.vercel.app/api/send-session-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
