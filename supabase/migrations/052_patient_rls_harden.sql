-- Harden patient-side RLS surface
--
-- Two issues caught in the post-merge audit:
--
-- 1. Discarded / ended patients retained portal access. The original
--    policies gated on patient_user_id alone — meaning a therapist
--    archiving a patient (status='discarded' or 'ended') didn't
--    revoke the patient's read access. Now every patient-side
--    SELECT also requires status IN ('active', 'potential'), which
--    matches "current relationship" in the therapist's data model.
--
-- 2. `Linked patients read therapist profile` opened the entire
--    user_profiles row to the patient. user_profiles contains
--    `signup_source` + `signup_source_detail` (acquisition channel
--    metadata: instagram, podcast, competitor referral, etc.) —
--    a privacy regression to expose those to the therapist's own
--    patients. RLS is row-level, not column-level, so the only
--    safe approach is to drop the policy entirely. The patient's
--    UI already reads therapist info exclusively through the
--    `get_therapists_for_patient()` security-definer RPC, which
--    returns ONLY profession + display name + email + avatar.
--    Direct SELECT on user_profiles is no longer permitted for
--    patients, and nothing in the patient app needs it.

-- ── Drop + replace the patient SELECT policies with status-gated
--    versions. Old policy names stay for blue/green safety:
--    Postgres won't let you alter a policy in place, so we drop
--    and recreate. Therapist-side policies are untouched.
drop policy if exists "Patients read own patient row" on patients;
create policy "Patients read own patient row"
  on patients for select
  using (
    patient_user_id = auth.uid()
    and status in ('active', 'potential')
  );

drop policy if exists "Patients read own sessions" on sessions;
create policy "Patients read own sessions"
  on sessions for select
  using (
    patient_id in (
      select id from patients
      where patient_user_id = auth.uid()
        and status in ('active', 'potential')
    )
  );

drop policy if exists "Patients read own payments" on payments;
create policy "Patients read own payments"
  on payments for select
  using (
    patient_id in (
      select id from patients
      where patient_user_id = auth.uid()
        and status in ('active', 'potential')
    )
  );

-- ── Drop the user_profiles patient policy entirely. Patient UI
--    already routes through get_therapists_for_patient() which
--    returns only the safe column subset. The RPC is security-
--    definer and uses its own internal WHERE clause as the
--    boundary; no client-side RLS needed.
drop policy if exists "Linked patients read therapist profile" on user_profiles;

-- The RPC also needs its own status gate now — a discarded patient
-- shouldn't even see who their (former) therapist was.
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
  where p.patient_user_id = auth.uid()
    and p.status in ('active', 'potential');
$$ language sql security definer;
