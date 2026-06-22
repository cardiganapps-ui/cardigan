-- 081_is_admin_search_path.sql
--
-- Security hardening: pin an empty search_path on is_admin().
--
-- is_admin() is SECURITY DEFINER and gates every admin-read-all RLS
-- policy, but (unlike the other definer functions in the schema, e.g.
-- admin_set_user_blocked) it didn't pin search_path. A SECURITY DEFINER
-- function with a mutable search_path is a standard audit finding: a role
-- that can create objects in a schema earlier on the search_path could
-- shadow an unqualified reference. The body here only calls the
-- fully-qualified auth.jwt(), so the practical risk is low — but pinning
-- search_path = '' removes the finding and matches the rest of the file.
--
-- Keep the email in sync with ADMIN_EMAIL (data/constants.ts) and
-- schema.sql, per CLAUDE.md.
create or replace function public.is_admin() returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  return auth.jwt() ->> 'email' = 'gaxioladiego@gmail.com';
end;
$$;
