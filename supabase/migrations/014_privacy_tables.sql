-- LFPDPPP-compliance scaffolding. Three tables:
--
-- 1. user_consents      — one row per (user, policy_version) stamped when
--                         the user accepts the aviso de privacidad.
--                         `policy_version` bumps when the policy body
--                         changes; the consent banner re-prompts until a
--                         matching row exists for the current version.
-- 2. account_deletions  — tombstone row written just before a user
--                         cascade-deletes their own account. Admin read-
--                         only; useful for support and audit.
-- 3. export_audit       — rate-limit guard. /api/export-user-data writes
--                         a row per call; a fresh call checks this table
--                         to refuse more than one export per user per
--                         hour (the export is cheap to generate but
--                         contains the full patient set).

create table if not exists public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  policy_version text not null,
  accepted_at timestamptz not null default now(),
  -- One row per (user, policy_version). Re-accepting the same version is
  -- a no-op upsert.
  unique (user_id, policy_version)
);

alter table public.user_consents enable row level security;

-- Users can read and insert their own consents; can't update or delete
-- (the record is audit evidence — let support ticket flows write-off any
-- corrections via the service role).
drop policy if exists "user_consents select own" on public.user_consents;
create policy "user_consents select own" on public.user_consents
  for select using (auth.uid() = user_id);

drop policy if exists "user_consents insert own" on public.user_consents;
create policy "user_consents insert own" on public.user_consents
  for insert with check (auth.uid() = user_id);

create index if not exists user_consents_user_idx on public.user_consents (user_id);

-- ── account_deletions ───────────────────────────────────────────────
create table if not exists public.account_deletions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text,
  reason text,
  deleted_at timestamptz not null default now()
);

alter table public.account_deletions enable row level security;

-- Only the admin can read this — it's deliberately not scoped to
-- `auth.uid() = user_id` because by the time a row exists, the owning
-- auth.users row has been wiped and that equality can never hold. Inserts
-- come exclusively from the service role (api/delete-my-account.js).
drop policy if exists "account_deletions admin select" on public.account_deletions;
create policy "account_deletions admin select" on public.account_deletions
  for select using (public.is_admin());

-- ── export_audit ────────────────────────────────────────────────────
create table if not exists public.export_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exported_at timestamptz not null default now(),
  bytes integer
);

alter table public.export_audit enable row level security;

drop policy if exists "export_audit select own" on public.export_audit;
create policy "export_audit select own" on public.export_audit
  for select using (auth.uid() = user_id);

-- Inserts come from the service role in api/export-user-data.js; users
-- never write here directly.

create index if not exists export_audit_user_time_idx
  on public.export_audit (user_id, exported_at desc);
