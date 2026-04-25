-- WhatsApp patient reminders (Meta Cloud API direct).
--
-- Adds:
--   1. Per-patient opt-in (`whatsapp_enabled` + `whatsapp_consent_at`) —
--      LFPDPPP consent capture is the timestamp on the patient row.
--   2. `channel` discriminator on `sent_reminders` so push and WhatsApp
--      dedupe independently. Existing rows default to 'push' so the
--      current cron behavior is preserved.
--   3. `whatsapp_audit` — one row per send attempt. Status walks
--      pending → sent → delivered (and optionally → read), or → failed.
--   4. `whatsapp_events` — raw status callbacks from Meta, joined to
--      `whatsapp_audit` by `meta_message_id`.
--
-- See plan: WhatsApp patient reminders, file
--   /root/.claude/plans/imagine-you-are-a-logical-whale.md
-- See ops doc: CLAUDE.md "WhatsApp reminders" section.

-- 1) Per-patient opt-in
alter table patients add column if not exists whatsapp_enabled boolean not null default false;
alter table patients add column if not exists whatsapp_consent_at timestamptz default null;

-- 2) Channel column on the existing dedup table.
-- Existing rows are all push (only channel that existed). The new
-- unique key is (session_id, user_id, channel) so a session can be
-- reminded on push AND WhatsApp without colliding.
alter table sent_reminders add column if not exists channel text not null default 'push';
alter table sent_reminders drop constraint if exists sent_reminders_session_id_user_id_key;
alter table sent_reminders drop constraint if exists sent_reminders_uniq;
alter table sent_reminders add constraint sent_reminders_uniq unique (session_id, user_id, channel);

-- 3) Outbound delivery audit
create table if not exists whatsapp_audit (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid references patients(id) on delete set null,
  session_id uuid references sessions(id) on delete cascade,
  recipient_phone text not null,
  template_name text not null,
  status text not null check (status in ('pending','sent','delivered','read','failed')),
  meta_message_id text,
  error_code text,
  error_reason text,
  raw_response jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_whatsapp_audit_user_id on whatsapp_audit(user_id);
create index if not exists idx_whatsapp_audit_meta_id on whatsapp_audit(meta_message_id);
alter table whatsapp_audit enable row level security;
drop policy if exists wa_audit_owner on whatsapp_audit;
create policy wa_audit_owner on whatsapp_audit using (auth.uid() = user_id);

-- 4) Raw webhook events (delivery callbacks). No user_id at insert
-- time — webhook is unauthenticated and the audit row holds the
-- user. Admin-only read via the same is_admin() helper used elsewhere.
create table if not exists whatsapp_events (
  id uuid default gen_random_uuid() primary key,
  meta_message_id text,
  event_type text,
  recipient_phone text,
  raw jsonb,
  created_at timestamptz default now()
);
create index if not exists idx_whatsapp_events_meta_id on whatsapp_events(meta_message_id);
alter table whatsapp_events enable row level security;
drop policy if exists wa_events_admin_read on whatsapp_events;
create policy wa_events_admin_read on whatsapp_events for select using (is_admin());
