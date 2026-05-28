-- 075 — tutor reminder push dedupe
--
-- The therapist app already surfaces a tutor-session reminder card in
-- the patient summary (ResumenTab) when a minor patient's configured
-- `tutor_frequency` is approaching or overdue. This migration backs
-- the push-notification side of the same signal — therapists wanted to
-- hear about it on their phone, not only when they happen to open the
-- Resumen tab.
--
-- Two push kinds, both opt-in via the existing
-- `notification_preferences.enabled` flag (same toggle that gates
-- session reminders, per the user's design call — one mental model):
--
--   tutor_due        — sent the first day daysUntilDue ≤ 0 AND nothing
--                      scheduled. "Le toca sesión con el tutor de X
--                      hoy y no hay nada agendado."
--   tutor_overdue_7  — sent ~7 days after the ideal date if still
--                      unscheduled. "Han pasado 7 días sin agendar la
--                      sesión con el tutor de X." Single follow-up
--                      then silent for this cycle — explicit user
--                      direction: no daily nag.
--
-- Both fire only inside the 10–19 local quiet-hours window (same as
-- referral nudges).
--
-- Dedupe model: (user_id, patient_id, kind, cycle_anchor_date). The
-- "cycle anchor" is the ISO date of the most recent completed (or
-- charged) tutor session for that patient — or the patient's
-- start_date / created_at when no tutor session has ever happened. A
-- NEW tutor session moves the anchor forward, so the next cycle gets
-- its own row pair (no collision with the previous cycle).
--
-- Scheduling a future tutor session does NOT change the anchor — it's
-- the "did it happen yet" signal that matters. While there's an
-- upcoming scheduled tutor session, the cron skips the patient
-- entirely (so a user who acted on the first reminder isn't pinged
-- again 7 days later).
--
-- Why a separate table from sent_reminders? sent_reminders.session_id
-- is NOT NULL referenced to sessions(id) — tutor reminders aren't
-- tied to a specific session row, so they don't fit. Mirrors the
-- shape (per-user, per-kind, with a cycle anchor) closely enough that
-- the cron's dedupe-then-send pattern stays familiar.

create table if not exists sent_tutor_reminders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  kind text not null check (kind in ('tutor_due', 'tutor_overdue_7')),
  cycle_anchor_date text not null,
  sent_at timestamptz default now(),
  unique (user_id, patient_id, kind, cycle_anchor_date)
);

create index if not exists idx_sent_tutor_reminders_user_id
  on sent_tutor_reminders(user_id);
create index if not exists idx_sent_tutor_reminders_patient_id
  on sent_tutor_reminders(patient_id);

alter table sent_tutor_reminders enable row level security;

-- Owner read — matches the sent_reminders policy. Service-role writes
-- are unaffected by RLS (uses the bypass key in the cron).
drop policy if exists "Users read own sent tutor reminders" on sent_tutor_reminders;
create policy "Users read own sent tutor reminders"
  on sent_tutor_reminders for select using (auth.uid() = user_id);

-- Admin read — same pattern as sent_reminders + the rest of the
-- audit-style tables. The cron writes via the service role so no
-- INSERT policy is needed.
drop policy if exists "Admin reads all sent tutor reminders" on sent_tutor_reminders;
create policy "Admin reads all sent tutor reminders"
  on sent_tutor_reminders for select using (is_admin());
