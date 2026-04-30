-- Singleton table tracking when our once-per-day maintenance jobs
-- last ran. Used to gate work that's piggybacked onto the
-- /api/send-session-reminders cron (which fires every 5 min) so we
-- don't re-run a daily purge 288 times a day.
--
-- Pattern: `update cron_state set <field> = now() where job = 'X' and
-- (last_run_at is null or last_run_at < now() - interval '23 hours')
-- returning *` — a successful return means we won the race for today.

create table if not exists cron_state (
  job text primary key,
  last_run_at timestamptz
);

-- Seed the rows we know about. Idempotent — INSERT … ON CONFLICT lets
-- us re-run this migration safely.
insert into cron_state (job, last_run_at) values
  ('purge_stripe_webhook_events', null)
on conflict (job) do nothing;

alter table cron_state enable row level security;

-- Admin-only read. Service role bypasses RLS and is the only writer.
create policy "Admin reads cron state"
  on cron_state for select
  using (is_admin());
