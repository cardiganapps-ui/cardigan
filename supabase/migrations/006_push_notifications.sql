-- Push notification infrastructure
-- Tables for storing push subscriptions, notification preferences,
-- and deduplicating sent reminders.

-- ============================================================
-- Push subscriptions (one row per device per user)
-- ============================================================
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

-- ============================================================
-- Notification preferences (one row per user)
-- ============================================================
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

-- ============================================================
-- Sent reminders (deduplication — one per session per user)
-- ============================================================
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

-- Service-role inserts sent_reminders from the cron endpoint,
-- so no insert policy is needed for authenticated users.
