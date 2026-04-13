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
  method text default 'Transferencia',
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

-- ============================================================
-- Indexes
-- ============================================================
create index if not exists idx_patients_user_id on patients(user_id);
create index if not exists idx_sessions_user_id on sessions(user_id);
create index if not exists idx_sessions_patient_id on sessions(patient_id);
create index if not exists idx_payments_user_id on payments(user_id);
create index if not exists idx_payments_patient_id on payments(patient_id);
create index if not exists idx_notes_user_id on notes(user_id);
create index if not exists idx_notes_patient_id on notes(patient_id);
create index if not exists idx_documents_user_id on documents(user_id);
create index if not exists idx_documents_patient_id on documents(patient_id);
create index if not exists idx_bug_reports_created_at on bug_reports(created_at);

-- ============================================================
-- Row Level Security (each user only sees their own data)
-- ============================================================
alter table patients enable row level security;
alter table sessions enable row level security;
alter table payments enable row level security;
alter table notes enable row level security;
alter table documents enable row level security;
alter table bug_reports enable row level security;

create policy "Users manage own patients" on patients for all using (auth.uid() = user_id);
create policy "Users manage own sessions" on sessions for all using (auth.uid() = user_id);
create policy "Users manage own payments" on payments for all using (auth.uid() = user_id);
create policy "Users manage own notes" on notes for all using (auth.uid() = user_id);
create policy "Users manage own documents" on documents for all using (auth.uid() = user_id);

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

-- Admin helper: fetch user profiles (email + name) from auth.users
create or replace function get_user_profiles()
returns table(id uuid, email text, full_name text) as $$
begin
  if not is_admin() then
    return;
  end if;
  return query
    select au.id, au.email::text, coalesce(au.raw_user_meta_data->>'full_name', '')::text as full_name
    from auth.users au;
end;
$$ language plpgsql security definer;
