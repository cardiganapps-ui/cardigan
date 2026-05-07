-- Patient-as-user link
--
-- Cardigan today is therapist-only — a `patients` row is metadata
-- the therapist owns. This migration introduces the patient as a
-- first-class auth.users identity, so a patient can sign in and see
-- their own slice of data.
--
-- A single auth.users.id can appear on N `patients` rows (one per
-- therapist they see), which makes multi-therapist support fall out
-- naturally without a separate join table.
--
-- RLS is purely additive — every existing therapist-side policy
-- stays as-is. We add patient-side SELECT policies that read
-- through `patient_user_id` for patients / sessions / payments, plus
-- a narrow SELECT on `user_profiles` so a linked patient can read
-- their therapist's profession (which drives the vocabulary engine).
--
-- Notes + documents do NOT get patient-side policies in v1 —
-- clinical notes and uploaded files stay therapist-only.

alter table patients
  add column if not exists patient_user_id uuid
    references auth.users(id) on delete set null;

create index if not exists idx_patients_patient_user_id
  on patients(patient_user_id) where patient_user_id is not null;

-- Patient-side RLS: a patient sees rows linked to their auth user.
create policy "Patients read own patient row"
  on patients for select
  using (patient_user_id = auth.uid());

create policy "Patients read own sessions"
  on sessions for select
  using (
    patient_id in (
      select id from patients where patient_user_id = auth.uid()
    )
  );

create policy "Patients read own payments"
  on payments for select
  using (
    patient_id in (
      select id from patients where patient_user_id = auth.uid()
    )
  );

-- Linked patient can read the user_profiles row of their therapist
-- (and only that therapist). Drives the vocabulary engine on the
-- patient side ("Tu psicóloga" vs "Tu nutrióloga").
create policy "Linked patients read therapist profile"
  on user_profiles for select
  using (
    user_id in (
      select user_id from patients where patient_user_id = auth.uid()
    )
  );

-- Single-call data fetcher for the patient shell. Returns one row
-- per linked-patients-row, joined with auth.users + user_profiles
-- so the patient can render the therapist's name, profession, email,
-- and avatar without N round-trips.
--
-- security definer because the function reads auth.users (locked
-- behind service role normally). The WHERE clause `patient_user_id
-- = auth.uid()` is the security boundary — the function returns
-- only rows the calling patient owns.
create or replace function get_therapists_for_patient()
returns table (
  patient_id uuid,
  therapist_user_id uuid,
  therapist_email text,
  therapist_full_name text,
  therapist_profession text,
  therapist_avatar text
) as $$
  select
    p.id,
    p.user_id,
    au.email::text,
    coalesce(au.raw_user_meta_data->>'full_name', '')::text,
    coalesce(up.profession, 'psychologist')::text,
    coalesce(au.raw_user_meta_data->>'avatar', '')::text
  from patients p
  join auth.users au on au.id = p.user_id
  left join user_profiles up on up.user_id = p.user_id
  where p.patient_user_id = auth.uid();
$$ language sql security definer;
