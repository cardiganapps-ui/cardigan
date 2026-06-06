-- Tutor-reminder dedupe ledger.
--
-- This table was created live (out-of-band) when the tutor-reminder
-- feature shipped and never made it into a migration — schema-drift
-- CI has been complaining every nightly run. This migration is a
-- catch-up: on production it's a no-op (CREATE TABLE IF NOT EXISTS),
-- on a fresh setup it provisions the table so the cron has somewhere
-- to write.
--
-- Purpose: the cron in api/send-session-reminders.js sends two
-- tutor-facing reminder kinds — `tutor_due` (balance crossed the
-- threshold) and `tutor_overdue_7` (7+ days overdue). Without a dedupe
-- ledger keyed on (user, patient, kind, cycle_anchor_date), a flaky
-- run would notify the tutor every 5 minutes for the same overdue
-- patient. `cycle_anchor_date` lets one patient cycle through
-- successive due/overdue states across months — text type matches the
-- "D-MMM" short-date encoding used elsewhere in the codebase.
--
-- Mirrors the (session_id, user_id) dedupe pattern of `sent_reminders`
-- — same RLS shape, admin-readable, owner-readable, service-role
-- writable only.

create table if not exists public.sent_tutor_reminders (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  patient_id          uuid not null references public.patients(id) on delete cascade,
  kind                text not null check (kind in ('tutor_due', 'tutor_overdue_7')),
  cycle_anchor_date   text not null,
  sent_at             timestamptz default now(),
  unique (user_id, patient_id, kind, cycle_anchor_date)
);

create index if not exists idx_sent_tutor_reminders_user_id
  on public.sent_tutor_reminders(user_id);

create index if not exists idx_sent_tutor_reminders_patient_id
  on public.sent_tutor_reminders(patient_id);

alter table public.sent_tutor_reminders enable row level security;

-- Owner-readable for audit + admin-readable for support visibility.
-- The cron writes via the service-role key, which bypasses RLS — no
-- INSERT policy needed for the hot path.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='sent_tutor_reminders'
      and policyname='Users read own sent tutor reminders'
  ) then
    create policy "Users read own sent tutor reminders"
      on public.sent_tutor_reminders
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='sent_tutor_reminders'
      and policyname='Admin reads all sent tutor reminders'
  ) then
    create policy "Admin reads all sent tutor reminders"
      on public.sent_tutor_reminders
      for select
      using (is_admin());
  end if;
end $$;
