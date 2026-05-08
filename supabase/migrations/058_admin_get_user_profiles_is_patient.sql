-- Differentiate patient users from therapist users in the admin panel.
--
-- Until now `get_user_profiles()` defaulted `profession` to
-- 'psychologist' for any auth.user lacking a `user_profiles` row,
-- which meant patient-side signups (no profession picker; signed up
-- via /i/<token>) rendered in the admin Users list as therapists.
--
-- Two changes:
--   1. Drop the COALESCE so profession is null when the user has no
--      `user_profiles` row. The client decides what to display.
--   2. Add `is_patient boolean` derived from any `patients` row whose
--      `patient_user_id` matches the auth user. Mirrors the role
--      detection in `src/hooks/useRoleDetection.js` (therapist =
--      profession set; patient = patient_user_id linkage; orphan =
--      neither). Admin reads through the security-definer body, so
--      RLS on `patients` doesn't block the EXISTS check.

drop function if exists get_user_profiles();
create or replace function get_user_profiles()
returns table(
  id uuid,
  email text,
  full_name text,
  banned_until timestamptz,
  created_at timestamptz,
  profession text,
  is_patient boolean
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
      up.profession::text,
      exists(
        select 1 from patients p
        where p.patient_user_id = au.id
      ) as is_patient
    from auth.users au
    left join user_profiles up on up.user_id = au.id;
end;
$$ language plpgsql security definer;
