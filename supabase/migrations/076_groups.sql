-- Groups (Grupos) — group sessions / classes.
--
-- Some users (group therapists, teachers, tutors, music instructors)
-- run sessions for several students at once. A "group" is a recurring
-- schedule template plus a roster of existing patients. When a group
-- occurrence happens it FANS OUT into one ordinary `sessions` row per
-- active member, each carrying that member's flat group rate and a new
-- `sessions.group_id` tag.
--
-- ⚠️ PRIME DIRECTIVE: group sessions are ORDINARY sessions in every
-- accounting respect. They carry a real patient_id and rate, so the
-- entire money pipeline (session_counts_at, recalc_patient_session_counters,
-- enrichPatientsWithBalance, the audit scripts) folds them in with ZERO
-- changes to money math. Occurrence identity is the natural key
-- (group_id, date, time) — no surrogate id. Groups carry no denormalized
-- financial counters; group finances are a derived rollup only.

-- ── groups: recurring schedule template ──
create table if not exists public.groups (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  name                text not null,
  color_idx           integer default 0,
  -- Recurring slot template (nullable day/time for episodic / one-off groups).
  day                 text,
  time                text,
  duration            integer default 60 check (duration > 0),
  -- Flat group rate applied to every member at fan-out time. Nullable so
  -- a group can be created before a rate is decided; fan-out falls back to
  -- the member's patient.rate when group.rate is null.
  rate                integer check (rate is null or rate >= 0),
  modality            text default 'presencial'
                        check (modality in ('presencial','virtual','telefonica','a-domicilio')),
  recurrence_frequency text not null default 'weekly'
                        check (recurrence_frequency in ('weekly','biweekly','monthly')),
  scheduling_mode     text not null default 'recurring'
                        check (scheduling_mode in ('recurring','episodic')),
  status              text not null default 'active'
                        check (status in ('active','ended')),
  -- Optimistic locking, reusing the shared bump_version_on_update trigger
  -- (migration 065) for cross-device safety — same pattern as sessions.
  version             integer not null default 1,
  created_at          timestamptz default now(),
  constraint groups_name_nonempty check (length(btrim(name)) > 0)
);

create index if not exists idx_groups_user_id on public.groups(user_id);

drop trigger if exists groups_bump_version on public.groups;
create trigger groups_bump_version
  before update on public.groups
  for each row execute function public.bump_version_on_update();

-- ── group_members: roster (which patients belong to which group) ──
-- Pure relationship data (no money), so both FKs cascade. The session
-- rows survive group/patient deletion via their own ON DELETE SET NULL —
-- that asymmetry is what protects financial history.
create table if not exists public.group_members (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  group_id    uuid not null references public.groups(id) on delete cascade,
  patient_id  uuid not null references public.patients(id) on delete cascade,
  joined_at   timestamptz default now(),
  -- Soft-leave: null = active member, set = historical. Removing a member
  -- stamps left_at and deletes their FUTURE scheduled group rows; past
  -- rows stay (the member still owes for sessions already consumed).
  left_at     timestamptz default null,
  created_at  timestamptz default now()
);

create index if not exists idx_group_members_group_id   on public.group_members(group_id);
create index if not exists idx_group_members_patient_id on public.group_members(patient_id);
create index if not exists idx_group_members_user_id     on public.group_members(user_id);

-- One ACTIVE membership per (group, patient). Re-adding a patient who left
-- inserts a fresh row; the partial predicate keeps only the live one unique.
create unique index if not exists uniq_group_member_active
  on public.group_members (group_id, patient_id) where left_at is null;

-- ── sessions.group_id ──
-- ON DELETE SET NULL: deleting a group must NEVER destroy session rows
-- (they are financial history). It detaches them instead. session_type
-- stays 'regular' for group rows — group_id is the only distinguishing
-- column, deliberately so group rows flow through every existing predicate.
alter table public.sessions
  add column if not exists group_id uuid references public.groups(id) on delete set null;

create index if not exists idx_sessions_group_id
  on public.sessions(group_id) where group_id is not null;
create index if not exists idx_sessions_group_occurrence
  on public.sessions(group_id, date, time) where group_id is not null;

-- ── CRITICAL: relax the therapist slot-uniqueness index for group rows ──
-- uniq_sessions_user_slot enforces "one scheduled session per therapist
-- slot". A group meeting puts N members at the SAME (user_id, date, time),
-- which would violate it. Exclude group rows from the constraint: group
-- concurrency is a single deliberate decision by the therapist (this group
-- meets here), not an accidental double-book. Adding group_id to the KEY
-- would still forbid two members of the same group sharing the slot — the
-- exact fan-out we need — so exclusion (group_id IS NULL) is the correct
-- fix. Member-level dedup is still covered by uniq_sessions_patient_date_time
-- (a member can't appear twice at one date/time, group or not).
drop index if exists uniq_sessions_user_slot;
create unique index if not exists uniq_sessions_user_slot
  on public.sessions(user_id, date, time)
  where status = 'scheduled' and group_id is null;

-- ── notes / documents can link to a group ──
-- ON DELETE SET NULL so a group note/doc survives group deletion (becomes
-- an unlinked note), mirroring the existing session_id SET NULL behavior.
-- A note/doc links to a patient OR a group (UI enforces the choice; the DB
-- stays permissive, same as the existing patient_id/session_id pair).
alter table public.notes
  add column if not exists group_id uuid references public.groups(id) on delete set null;
alter table public.documents
  add column if not exists group_id uuid references public.groups(id) on delete set null;

create index if not exists idx_notes_group_id
  on public.notes(group_id) where group_id is not null;
create index if not exists idx_documents_group_id
  on public.documents(group_id) where group_id is not null;

-- ── RLS (mirror the auth.uid() = user_id pattern + admin read) ──
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='groups' and policyname='Users manage own groups') then
    create policy "Users manage own groups" on public.groups
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='groups' and policyname='Admin reads all groups') then
    create policy "Admin reads all groups" on public.groups
      for select using (is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='group_members' and policyname='Users manage own group members') then
    create policy "Users manage own group members" on public.group_members
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='group_members' and policyname='Admin reads all group members') then
    create policy "Admin reads all group members" on public.group_members
      for select using (is_admin());
  end if;
end $$;
