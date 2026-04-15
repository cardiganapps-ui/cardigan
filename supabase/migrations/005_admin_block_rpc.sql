-- Migration 005: dedicated RPC for blocking / unblocking a user by
-- writing auth.users.banned_until directly.
--
-- Why an RPC instead of the Supabase admin API?
--   supabase.auth.admin.updateUserById({ ban_duration }) is the
--   "official" path but rejects long durations silently in some
--   Supabase projects (the block call returned a generic failure).
--   Writing banned_until ourselves is deterministic and doesn't depend
--   on the GoTrue ban_duration parser.
--
-- Security model:
--   /api/admin-block-user already verifies the caller's JWT email is
--   the admin before dispatching. This RPC is then invoked via the
--   service-role client from that route. We revoke execute from public,
--   anon, and authenticated so no browser-side caller can trigger it
--   via PostgREST, even if they guess the name.

create or replace function admin_set_user_blocked(target_user_id uuid, blocked boolean)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  update auth.users
  set banned_until = case when blocked then '2999-01-01'::timestamptz else null end
  where id = target_user_id;
end;
$$;

revoke execute on function admin_set_user_blocked(uuid, boolean) from public;
revoke execute on function admin_set_user_blocked(uuid, boolean) from anon;
revoke execute on function admin_set_user_blocked(uuid, boolean) from authenticated;
grant execute on function admin_set_user_blocked(uuid, boolean) to service_role;
