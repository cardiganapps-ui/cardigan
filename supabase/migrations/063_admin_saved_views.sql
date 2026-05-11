-- 063 — admin_saved_views: shared filter presets for the admin team
--
-- Phase 2 of the admin redesign. Lets any admin save a named filter
-- combo on a screen (e.g. "Trial users with 0 patients" on Users) and
-- have it appear in the saved-views dropdown for every other admin.
--
-- Solo today, designed for the small-team future per the redesign plan.
-- All admins can read+write all rows — no per-row ownership gate
-- because the use case is shared playbooks. `created_by` is recorded
-- for audit but never used for ACL.
--
-- filter_state holds the per-screen filter shape (search query, active
-- pills, sort key/dir) as JSON. Capped at 4 KB to defend against an
-- accidental dump of a huge nested object.

create table if not exists public.admin_saved_views (
  id uuid primary key default gen_random_uuid(),
  -- Which screen this view applies to. Tightly enumerated so a typo
  -- can't strand a view on a non-existent screen.
  screen text not null check (screen in (
    'users', 'audit', 'revenue', 'acquisition', 'codes', 'reports'
  )),
  name text not null check (length(name) between 1 and 60),
  -- Per-screen filter snapshot (search, active pills, sort, etc.).
  -- Each screen owns the shape; the table only enforces size.
  filter_state jsonb not null,
  -- The admin auth.users(id) who created the view. No FK so deletes of
  -- the admin user don't cascade-drop the view (parity with audit log).
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 4 KB cap on the JSON payload. Octet length on the text rendering
  -- is an upper bound; tight enough to reject runaway state.
  constraint admin_saved_views_filter_state_size
    check (octet_length(filter_state::text) <= 4096)
);

-- Index for the read pattern: list-by-screen, newest first.
create index if not exists idx_admin_saved_views_screen_created
  on public.admin_saved_views (screen, created_at desc);

-- updated_at maintenance trigger. search_path explicitly pinned to
-- defend against role-mutable lint (Supabase advisor 0011).
create or replace function public.admin_saved_views_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists admin_saved_views_set_updated_at_trg on public.admin_saved_views;
create trigger admin_saved_views_set_updated_at_trg
  before update on public.admin_saved_views
  for each row execute function public.admin_saved_views_set_updated_at();

-- RLS — admin-only on every operation. Shared across the whole admin
-- team; no per-row ownership gate.
alter table public.admin_saved_views enable row level security;

drop policy if exists "Admin reads saved views" on public.admin_saved_views;
create policy "Admin reads saved views"
  on public.admin_saved_views for select
  using (is_admin());

drop policy if exists "Admin inserts saved views" on public.admin_saved_views;
create policy "Admin inserts saved views"
  on public.admin_saved_views for insert
  with check (is_admin());

drop policy if exists "Admin updates saved views" on public.admin_saved_views;
create policy "Admin updates saved views"
  on public.admin_saved_views for update
  using (is_admin())
  with check (is_admin());

drop policy if exists "Admin deletes saved views" on public.admin_saved_views;
create policy "Admin deletes saved views"
  on public.admin_saved_views for delete
  using (is_admin());
