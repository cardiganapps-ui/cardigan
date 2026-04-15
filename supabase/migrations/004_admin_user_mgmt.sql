-- Migration 004: expose banned_until on get_user_profiles so the admin
-- panel can render a "Bloqueado" badge. Blocking/unblocking itself is
-- performed server-side through /api/admin-block-user, which uses the
-- service-role key to call auth.admin.updateUserById.
--
-- Run this in the Supabase SQL editor after the base schema is applied.

create or replace function get_user_profiles()
returns table(id uuid, email text, full_name text, banned_until timestamptz, created_at timestamptz)
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
      au.created_at
    from auth.users au;
end;
$$ language plpgsql security definer;
