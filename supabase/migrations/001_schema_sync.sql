-- 001_schema_sync.sql
-- Incremental migration to bring a live Cardigan DB in sync with schema.sql.
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS guards throughout.
--
-- Run in Supabase SQL Editor (https://supabase.com/dashboard).
-- Always test on a staging project first.

-- ============================================================
-- 1. Add missing columns to existing tables
-- ============================================================

-- patients: phone, email
alter table patients add column if not exists phone text default '';
alter table patients add column if not exists email text default '';

-- patients: rate CHECK constraint (safe: does not fail if already exists)
do $$
begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'patients_rate_check'
  ) then
    alter table patients add constraint patients_rate_check check (rate >= 0);
  end if;
end $$;

-- payments: note column
alter table payments add column if not exists note text default null;

-- payments: amount CHECK constraint
do $$
begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'payments_amount_check'
  ) then
    alter table payments add constraint payments_amount_check check (amount > 0);
  end if;
end $$;

-- sessions: duration column (minutes, default 60)
alter table sessions add column if not exists duration integer default 60;

-- sessions: rate column (for per-session rate overrides)
alter table sessions add column if not exists rate integer default null;

-- notes: pinned column
alter table notes add column if not exists pinned boolean default false;

-- ============================================================
-- 2. Create documents table
-- ============================================================
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

-- ============================================================
-- 3. Create bug_reports table
-- ============================================================
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
-- 4. Indexes
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
-- 5. RLS on new tables
-- ============================================================
alter table documents enable row level security;
alter table bug_reports enable row level security;

-- Documents: user isolation
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'documents' and policyname = 'Users manage own documents'
  ) then
    create policy "Users manage own documents" on documents for all using (auth.uid() = user_id);
  end if;
end $$;

-- Bug reports: any authenticated user can insert; users read own; admin manages all
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'bug_reports' and policyname = 'Users insert own bug reports'
  ) then
    create policy "Users insert own bug reports" on bug_reports for insert with check (auth.uid() is not null);
  end if;
  if not exists (
    select 1 from pg_policies where tablename = 'bug_reports' and policyname = 'Users read own bug reports'
  ) then
    create policy "Users read own bug reports" on bug_reports for select using (auth.uid() = user_id);
  end if;
end $$;

-- Admin read access on new tables
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'documents' and policyname = 'Admin reads all documents'
  ) then
    create policy "Admin reads all documents" on documents for select using (is_admin());
  end if;
  if not exists (
    select 1 from pg_policies where tablename = 'bug_reports' and policyname = 'Admin manages all bug reports'
  ) then
    create policy "Admin manages all bug reports" on bug_reports for all using (is_admin());
  end if;
end $$;
