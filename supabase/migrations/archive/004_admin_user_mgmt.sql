-- Migration 004: expose banned_until on get_user_profiles so the admin
-- panel can render a "Bloqueado" badge. Blocking/unblocking itself is
-- performed server-side through /api/admin-block-user, which uses the
-- service-role key to call auth.admin.updateUserById.
--
-- Run this in the Supabase SQL editor after the base schema is applied.

-- The return type changes (adds banned_until + created_at), and Postgres
-- can't CREATE OR REPLACE across return-type changes, so drop first.
drop function if exists get_user_profiles();

-- Plain SQL function (no plpgsql) to avoid any aliased identifiers that
-- can trip up copy/paste through HTML-rendering clients. The WHERE
-- is_admin() clause short-circuits to an empty result set for non-admins.
create or replace function get_user_profiles()
returns table(
  id uuid,
  email text,
  full_name text,
  banned_until timestamptz,
  created_at timestamptz
)
language sql
security definer
as $$
  select
    id,
    email::text,
    coalesce(raw_user_meta_data ->> 'full_name', '')::text,
    banned_until,
    created_at
  from auth.users
  where is_admin();
$$;
