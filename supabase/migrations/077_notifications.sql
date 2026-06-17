-- In-app notification inbox.
--
-- Push notifications are ephemeral (a banner the OS may drop). This table
-- is the durable record so the user can open an in-app inbox, read past
-- notifications, mark them read, and clear them. Rows are written
-- SERVER-SIDE only (the cron reminder path + an admin/system path via the
-- service role) — there is deliberately NO user INSERT policy, so a client
-- can never fabricate a notification. Users may read / mark-read / delete
-- their own rows.
--
-- kind:
--   'reminder' — written by api/send-session-reminders.js when a session
--                reminder fires. Deduped per (user, session) by the partial
--                unique index below so cron re-runs are idempotent (23505 →
--                skip), mirroring uniq_sessions_patient_date_time's contract.
--   'system'   — app/admin-generated message (announcements, account
--                notices), written by api/admin-notify.js via the service role.

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null default 'reminder'
                check (kind in ('reminder','system')),
  title       text not null,
  body        text not null default '',
  url         text default '/',
  -- Optional context links. SET NULL (not cascade) so deleting a session or
  -- patient leaves the historical notification intact but unlinked — same
  -- asymmetry that protects financial history elsewhere.
  session_id  uuid references public.sessions(id) on delete set null,
  patient_id  uuid references public.patients(id) on delete set null,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Inbox query: newest-first per user, plus a cheap unread-count scan.
create index if not exists idx_notifications_user_created
  on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_unread
  on public.notifications(user_id) where read = false;

-- Idempotency for the reminder path: at most one reminder notification per
-- (user, session). The cron INSERT handles 23505 as a no-op.
create unique index if not exists uniq_notifications_reminder
  on public.notifications(user_id, session_id)
  where kind = 'reminder' and session_id is not null;

-- ── RLS (mirror auth.uid() = user_id + admin read; NO user insert) ──
alter table public.notifications enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='Users read own notifications') then
    create policy "Users read own notifications" on public.notifications
      for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='Users update own notifications') then
    create policy "Users update own notifications" on public.notifications
      for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='Users delete own notifications') then
    create policy "Users delete own notifications" on public.notifications
      for delete using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='Admin reads all notifications') then
    create policy "Admin reads all notifications" on public.notifications
      for select using (is_admin());
  end if;
end $$;
