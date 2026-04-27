-- Anthropometric tracking for nutritionists + personal trainers.
--
-- Two parts:
-- 1. patients gains four nutrition/fitness-static fields:
--      height_cm, goal_weight_kg, allergies, medical_conditions.
--    These describe the person, not the visit, so they live on patients.
--    Nullable + zero-defaults → existing rows (psychologists, etc.) stay
--    untouched; the columns just sit unused.
-- 2. New `measurements` table tracks the things that change per visit
--    (weight, waist, hip, body fat %). One row per measurement event.
--
-- The frontend gates this surface area on usesAnthropometrics(profession),
-- which today returns true for nutritionist + trainer. Other professions
-- never see the Mediciones tab and never write to either column / table.

alter table patients add column if not exists height_cm        integer;
alter table patients add column if not exists goal_weight_kg   numeric(5,2);
alter table patients add column if not exists allergies        text default '';
alter table patients add column if not exists medical_conditions text default '';

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

-- Hot path: list a patient's measurements newest-first for the tab + sparkline.
create index if not exists idx_measurements_patient
  on measurements(patient_id, taken_at desc);
create index if not exists idx_measurements_user_id
  on measurements(user_id);

alter table measurements enable row level security;
create policy "Users manage own measurements" on measurements for all using (auth.uid() = user_id);
create policy "Admin reads all measurements" on measurements for select using (is_admin());
