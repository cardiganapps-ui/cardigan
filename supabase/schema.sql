-- Cardigan Schema
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard)

-- Patients
create table if not exists patients (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  name text not null,
  parent text default '',
  initials text not null,
  rate integer default 700 check (rate >= 0),
  day text default 'Lunes',
  time text default '16:00',
  status text default 'active' check (status in ('active', 'ended')),
  billed integer default 0,
  paid integer default 0,
  sessions integer default 0,
  color_idx integer default 0,
  start_date date,
  birthdate date,
  phone text default '',
  email text default '',
  tutor_frequency integer default null,
  -- Nutritionist + trainer fields. Static traits of the person rather
  -- than per-visit measurements. Surfaced via usesAnthropometrics()
  -- in src/data/constants.js — other professions never see them.
  height_cm integer,
  goal_weight_kg numeric(5,2),
  allergies text default '',
  medical_conditions text default '',
  created_at timestamptz default now()
);

-- Sessions
create table if not exists sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  patient_id uuid references patients(id) on delete cascade,
  patient text not null,
  initials text not null,
  time text not null,
  day text not null,
  date text not null,
  status text default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'charged')),
  duration integer default 60,
  rate integer default null,
  cancel_reason text default null,
  modality text default 'presencial' check (modality in ('presencial', 'virtual', 'telefonica', 'a-domicilio')),
  -- 'regular' = appointment with the patient/client/student themselves;
  -- 'tutor'   = appointment with the parent/legal guardian of a minor.
  -- Replaces the historical "T·" initials prefix as the source of truth
  -- (see migration 023). Read paths keep the prefix fallback.
  session_type text not null default 'regular' check (session_type in ('regular', 'tutor')),
  color_idx integer default 0,
  created_at timestamptz default now()
);

-- Payments
create table if not exists payments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  patient_id uuid references patients(id) on delete set null,
  patient text not null,
  initials text not null,
  amount integer not null check (amount > 0),
  date text not null,
  method text default 'Transferencia' check (method in ('Transferencia', 'Efectivo', 'Tarjeta', 'Retiro sin Tarjeta', 'Otro')),
  note text default null,
  color_idx integer default 0,
  created_at timestamptz default now()
);

-- Notes (session notes and general patient notes)
create table if not exists notes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  patient_id uuid references patients(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  title text default '',
  content text default '',
  pinned boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Documents (file metadata; actual files stored in R2)
create table if not exists documents (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  patient_id uuid references patients(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  name text not null,
  file_path text not null unique,
  file_type text default 'application/octet-stream',
  file_size integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Bug reports (submitted from in-app bug reporter)
create table if not exists bug_reports (
  id uuid default gen_random_uuid() primary key,
  user_id uuid,
  user_email text,
  description text,
  screen text,
  logs jsonb,
  user_agent text,
  created_at timestamptz default now(),
  archived_at timestamptz
);

-- Push subscriptions (one row per device per user)
create table if not exists push_subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

-- Notification preferences (one row per user)
create table if not exists notification_preferences (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null unique,
  enabled boolean default true,
  reminder_minutes integer default 30,
  timezone text default 'America/Mexico_City',
  updated_at timestamptz default now()
);

-- Sent reminders (deduplication — one per session per user)
create table if not exists sent_reminders (
  id uuid default gen_random_uuid() primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid not null,
  sent_at timestamptz default now(),
  unique(session_id, user_id)
);

-- Anthropometric measurements (nutritionist + trainer). One row per
-- visit/check-in. Schema mirrors migration 024_measurements.sql.
create table if not exists measurements (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  patient_id uuid not null references patients(id) on delete cascade,
  taken_at date not null,
  weight_kg     numeric(5,2),
  waist_cm      numeric(5,2),
  hip_cm        numeric(5,2),
  body_fat_pct  numeric(4,2),
  notes         text default '',
  created_at    timestamptz default now()
);

-- User profession (multi-profession expansion). Locked at sign-up,
-- admin-changeable. The check constraint mirrors PROFESSION in
-- src/data/constants.js.
create table if not exists user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profession text not null check (profession in (
    'psychologist', 'nutritionist', 'tutor', 'music_teacher', 'trainer'
  )),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- Indexes
-- ============================================================
create index if not exists idx_patients_user_id on patients(user_id);
create index if not exists idx_sessions_user_id on sessions(user_id);
create index if not exists idx_sessions_patient_id on sessions(patient_id);
create index if not exists idx_sessions_session_type on sessions(session_type);
-- One session per (patient, date, time). DB-level guard against dupes;
-- client-side dedup alone has proven unreliable (stale state across tabs,
-- date-only comparisons, regen paths re-inserting cancelled slots).
-- Partial on patient_id NOT NULL because the column is nullable.
create unique index if not exists uniq_sessions_patient_date_time
  on sessions (patient_id, date, time) where patient_id is not null;
create index if not exists idx_payments_user_id on payments(user_id);
create index if not exists idx_payments_patient_id on payments(patient_id);
create index if not exists idx_notes_user_id on notes(user_id);
create index if not exists idx_notes_patient_id on notes(patient_id);
create index if not exists idx_documents_user_id on documents(user_id);
create index if not exists idx_documents_patient_id on documents(patient_id);
create index if not exists idx_bug_reports_created_at on bug_reports(created_at);
create index if not exists idx_push_subscriptions_user_id on push_subscriptions(user_id);
create index if not exists idx_notification_preferences_user_id on notification_preferences(user_id);
create index if not exists idx_sent_reminders_user_id on sent_reminders(user_id);
create index if not exists idx_sent_reminders_session_id on sent_reminders(session_id);
create index if not exists idx_user_profiles_profession on user_profiles(profession);
create index if not exists idx_measurements_patient on measurements(patient_id, taken_at desc);
create index if not exists idx_measurements_user_id on measurements(user_id);

-- ============================================================
-- Row Level Security (each user only sees their own data)
-- ============================================================
alter table patients enable row level security;
alter table sessions enable row level security;
alter table payments enable row level security;
alter table notes enable row level security;
alter table documents enable row level security;
alter table bug_reports enable row level security;
alter table push_subscriptions enable row level security;
alter table notification_preferences enable row level security;
alter table sent_reminders enable row level security;
alter table user_profiles enable row level security;
alter table measurements enable row level security;

create policy "Users manage own patients" on patients for all using (auth.uid() = user_id);
create policy "Users manage own sessions" on sessions for all using (auth.uid() = user_id);
create policy "Users manage own payments" on payments for all using (auth.uid() = user_id);
create policy "Users manage own notes" on notes for all using (auth.uid() = user_id);
create policy "Users manage own documents" on documents for all using (auth.uid() = user_id);
create policy "Users manage own push subscriptions" on push_subscriptions for all using (auth.uid() = user_id);
create policy "Users manage own notification preferences" on notification_preferences for all using (auth.uid() = user_id);
create policy "Users read own sent reminders" on sent_reminders for select using (auth.uid() = user_id);
create policy "Users read own profile"   on user_profiles for select using (auth.uid() = user_id);
create policy "Users insert own profile" on user_profiles for insert with check (auth.uid() = user_id);
create policy "Users update own profile" on user_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own measurements" on measurements for all using (auth.uid() = user_id);

-- Bug reports: any authenticated user can insert; only admin can read/manage
create policy "Users insert own bug reports" on bug_reports for insert with check (auth.uid() is not null);
create policy "Users read own bug reports" on bug_reports for select using (auth.uid() = user_id);

-- Admin read-only access (can view all users' data)
create or replace function is_admin() returns boolean as $$
begin
  return auth.jwt() ->> 'email' = 'gaxioladiego@gmail.com';
end;
$$ language plpgsql security definer;

create policy "Admin reads all patients" on patients for select using (is_admin());
create policy "Admin reads all sessions" on sessions for select using (is_admin());
create policy "Admin reads all payments" on payments for select using (is_admin());
create policy "Admin reads all notes" on notes for select using (is_admin());
create policy "Admin reads all documents" on documents for select using (is_admin());
create policy "Admin manages all bug reports" on bug_reports for all using (is_admin());
create policy "Admin reads all push subscriptions" on push_subscriptions for select using (is_admin());
create policy "Admin reads all notification preferences" on notification_preferences for select using (is_admin());
create policy "Admin reads all profiles" on user_profiles for select using (is_admin());
create policy "Admin updates all profiles" on user_profiles for update using (is_admin()) with check (is_admin());
create policy "Admin reads all measurements" on measurements for select using (is_admin());

-- Admin helper: archive bug reports (bypasses RLS via security definer)
create or replace function archive_bug_reports(report_ids uuid[])
returns void as $$
begin
  if not is_admin() then
    raise exception 'Unauthorized';
  end if;
  update bug_reports set archived_at = now() where id = any(report_ids);
end;
$$ language plpgsql security definer;

-- Admin helper: block/unblock a user by writing auth.users.banned_until
-- directly. Called from /api/admin-block-user via the service-role
-- client; execution is revoked from anon/authenticated so nothing
-- browser-side can hit it via PostgREST.
create or replace function admin_set_user_blocked(target_user_id uuid, blocked boolean)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  update auth.users
  set banned_until = case when blocked then '2999-01-01'::timestamptz else null end
  where id = target_user_id;
end;
$$;

revoke execute on function admin_set_user_blocked(uuid, boolean) from public;
revoke execute on function admin_set_user_blocked(uuid, boolean) from anon;
revoke execute on function admin_set_user_blocked(uuid, boolean) from authenticated;
grant execute on function admin_set_user_blocked(uuid, boolean) to service_role;

-- Admin helper: fetch user profiles (email + name + ban state) from
-- auth.users. banned_until powers the "Bloqueado" badge in the admin
-- panel; blocking is performed server-side via /api/admin-block-user.
create or replace function get_user_profiles()
returns table(
  id uuid,
  email text,
  full_name text,
  banned_until timestamptz,
  created_at timestamptz,
  profession text
)
as $$
begin
  if not is_admin() then
    return;
  end if;
  return query
    select
      au.id,
      au.email::text,
      coalesce(au.raw_user_meta_data->>'full_name', '')::text as full_name,
      au.banned_until,
      au.created_at,
      coalesce(up.profession, 'psychologist')::text as profession
    from auth.users au
    left join user_profiles up on up.user_id = au.id;
end;
$$ language plpgsql security definer;
