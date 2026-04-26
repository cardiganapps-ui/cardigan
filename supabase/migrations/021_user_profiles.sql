-- Per-user profession (Phase 1 of multi-profession expansion).
-- Cardigan is expanding beyond psychologists to nutritionists, tutors,
-- music teachers, and personal trainers. Each user picks a profession at
-- sign-up; the choice is locked thereafter (admin can change it).
--
-- We store this in its own table rather than auth.users.user_metadata
-- because server-side logic (e.g. the WhatsApp reminder cron) needs to
-- filter and join on profession from SQL.
--
-- The check constraint mirrors PROFESSION in src/data/constants.js —
-- keep them in sync, like SESSION_STATUS / PAYMENT_METHOD.

create table if not exists user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profession text not null check (profession in (
    'psychologist', 'nutritionist', 'tutor', 'music_teacher', 'trainer'
  )),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_user_profiles_profession on user_profiles(profession);

alter table user_profiles enable row level security;

create policy "Users read own profile"   on user_profiles for select using (auth.uid() = user_id);
create policy "Users insert own profile" on user_profiles for insert with check (auth.uid() = user_id);
create policy "Users update own profile" on user_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Admin reads all profiles" on user_profiles for select using (is_admin());
create policy "Admin updates all profiles" on user_profiles for update using (is_admin()) with check (is_admin());

-- Backfill: every existing auth user is a psychologist (the original
-- product). New sign-ups go through ProfessionOnboarding.
insert into user_profiles (user_id, profession)
  select id, 'psychologist' from auth.users
  on conflict (user_id) do nothing;

-- Update get_user_profiles() to include profession, so the admin panel
-- can show + change it. The function is admin-only (returns nothing for
-- non-admins) — preserved.
drop function if exists get_user_profiles();
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
