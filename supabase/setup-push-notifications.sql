-- ============================================================
-- PUSH NOTIFICATIONS — Complete Setup
-- Run this ONCE in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- Step 1: Enable required extensions
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Step 2: Push subscriptions table
create table if not exists push_subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

create index if not exists idx_push_subscriptions_user_id on push_subscriptions(user_id);
alter table push_subscriptions enable row level security;
create policy "Users manage own push subscriptions"
  on push_subscriptions for all using (auth.uid() = user_id);
create policy "Admin reads all push subscriptions"
  on push_subscriptions for select using (is_admin());

-- Step 3: Notification preferences table
create table if not exists notification_preferences (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null unique,
  enabled boolean default true,
  reminder_minutes integer default 30,
  timezone text default 'America/Mexico_City',
  updated_at timestamptz default now()
);

create index if not exists idx_notification_preferences_user_id on notification_preferences(user_id);
alter table notification_preferences enable row level security;
create policy "Users manage own notification preferences"
  on notification_preferences for all using (auth.uid() = user_id);
create policy "Admin reads all notification preferences"
  on notification_preferences for select using (is_admin());

-- Step 4: Sent reminders (deduplication)
create table if not exists sent_reminders (
  id uuid default gen_random_uuid() primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid not null,
  sent_at timestamptz default now(),
  unique(session_id, user_id)
);

create index if not exists idx_sent_reminders_user_id on sent_reminders(user_id);
create index if not exists idx_sent_reminders_session_id on sent_reminders(session_id);
alter table sent_reminders enable row level security;
create policy "Users read own sent reminders"
  on sent_reminders for select using (auth.uid() = user_id);

-- Step 5: Store the cron secret for pg_cron → Vercel auth
-- IMPORTANT: Replace the value below with your actual CRON_SECRET
alter database postgres set app.cron_secret = 'eaafd73efc0766e2623b7075c47609a9bad7fc7a5d0643b4ee3735fca87a2c7f';

-- Step 6: Schedule the reminder cron (every 5 minutes)
select cron.schedule(
  'send-session-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://cardigan-fawn.vercel.app/api/send-session-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
