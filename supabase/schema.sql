-- Cardigan MVP Schema
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard)

-- Patients
create table if not exists patients (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  name text not null,
  parent text default '',
  initials text not null,
  rate integer default 700,
  day text default 'Lunes',
  time text default '16:00',
  status text default 'active' check (status in ('active', 'ended')),
  billed integer default 0,
  paid integer default 0,
  sessions integer default 0,
  color_idx integer default 0,
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
  status text default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
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
  amount integer not null,
  date text not null,
  method text default 'Transferencia',
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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Row Level Security (each user only sees their own data)
alter table patients enable row level security;
alter table sessions enable row level security;
alter table payments enable row level security;

alter table notes enable row level security;

create policy "Users manage own patients" on patients for all using (auth.uid() = user_id);
create policy "Users manage own sessions" on sessions for all using (auth.uid() = user_id);
create policy "Users manage own payments" on payments for all using (auth.uid() = user_id);
create policy "Users manage own notes" on notes for all using (auth.uid() = user_id);

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
