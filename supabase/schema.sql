-- Cardigan Schema
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard)

-- Patients
create table if not exists patients (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  name text not null,
  parent text default '',
  initials text not null,
  rate integer default 700 check (rate >= 0),
  day text default 'Lunes',
  time text default '16:00',
  -- 'active' / 'ended' are the regular patient lifecycle. 'potential'
  -- and 'discarded' belong to the interview-stage flow (migration 047):
  -- a 'potential' is an interviewee under evaluation, not counted in
  -- KPIs and never picked up by recurring auto-extend; 'discarded' is
  -- a soft-archive for potentials that didn't convert. ConvertPotential
  -- flips 'potential' → 'active' in place to preserve the interview row
  -- as part of the patient's history.
  status text default 'active' check (status in ('active', 'ended', 'potential', 'discarded')),
  billed integer default 0,
  paid integer default 0,
  sessions integer default 0,
  -- Opening balance carried into Cardigan when a patient is migrated
  -- mid-relationship. Signed MXN: >0 = pre-existing debt (owes), <0 =
  -- saldo a favor (credit), 0 = none (default). Folded into amountDue as
  -- an extra term (delta = consumed - paid + opening_balance) in
  -- utils/accounting.js; NOT a session/payment row, so it never touches
  -- the billed/paid/sessions counters or income. See migration 078.
  opening_balance integer not null default 0,
  color_idx integer default 0,
  start_date date,
  birthdate date,
  phone text default '',
  email text default '',
  tutor_frequency integer default null,
  -- Nutritionist + trainer fields. Static traits of the person rather
  -- than per-visit measurements. Surfaced via usesAnthropometrics()
  -- in src/data/constants.js — other professions never see them.
  height_cm integer,
  goal_weight_kg numeric(5,2),
  allergies text default '',
  medical_conditions text default '',
  -- Per-patient external folder link (migration 049). User pastes a
  -- Drive/OneDrive/Dropbox/iCloud/etc URL; UI renders a tap-to-open
  -- card in the Documentos tab. Cardigan never accesses the contents
  -- — the link is just text. NULL = no folder linked.
  external_folder_url text
    check (external_folder_url is null or length(external_folder_url) <= 2048),
  -- Patient-as-user link (migration 050). Nullable FK to auth.users
  -- — when set, the patient owning that auth row can SELECT this
  -- patients row + its sessions/payments via the patient-side RLS
  -- policies. A single auth.users.id can appear on N patient rows
  -- across N therapists (multi-therapist support).
  patient_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

-- Sessions
create table if not exists sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  patient_id uuid references patients(id) on delete cascade,
  patient text not null,
  initials text not null,
  time text not null,
  day text not null,
  date text not null,
  status text default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'charged')),
  duration integer default 60,
  rate integer default null,
  cancel_reason text default null,
  modality text default 'presencial' check (modality in ('presencial', 'virtual', 'telefonica', 'a-domicilio')),
  -- 'regular'   = appointment with the patient/client/student themselves;
  -- 'tutor'     = appointment with the parent/legal guardian of a minor;
  -- 'interview' = first-contact session with a 'potential' patient
  --               (migration 047). Always created with is_recurring=false
  --               so it never seeds an auto-extend recurring slot, even
  --               post-conversion. Surfaces with a rose visual accent and
  --               the per-profession "Entrevista" / "Clase de prueba" /
  --               "Evaluación inicial" / "Consulta inicial" label.
  -- Replaces the historical "T·" initials prefix as the source of truth
  -- (see migration 023). Read paths keep the prefix fallback.
  session_type text not null default 'regular' check (session_type in ('regular', 'tutor', 'interview')),
  -- True when the row was created as part of a recurring weekly
  -- schedule (NewPatientSheet's seed insert, applyScheduleChange,
  -- or auto-extend). False for manual one-off sessions added via
  -- NewSessionSheet. computeAutoExtendRows requires is_recurring=true
  -- when deriving the patient's current schedule, so a mistaken
  -- manual session can never seed a phantom recurrence. See
  -- supabase/migrations/025_sessions_is_recurring.sql.
  is_recurring boolean not null default false,
  -- Stride of the recurring schedule that minted this row. Read by
  -- auto-extend so an existing biweekly slot projects forward at the
  -- correct cadence. Property of the SLOT — every session in the
  -- same (patient, day, time) carries the same value. See migration
  -- 044.
  recurrence_frequency text not null default 'weekly'
    check (recurrence_frequency in ('weekly', 'biweekly', 'monthly')),
  color_idx integer default 0,
  -- Reschedule audit (migration 057). Updated in place by both the
  -- therapist-side rescheduleSession helper and the patient-side
  -- /api/patient-reschedule-session endpoint so a single row stays
  -- attached to the underlying engagement (notes, cancellation
  -- history, pending push reminders). last_rescheduled_from is JSON
  -- so future fields (duration, modality) can be captured without
  -- another migration.
  last_rescheduled_at timestamptz,
  last_rescheduled_from jsonb,
  -- Optimistic locking (migration 065). Bumped by the
  -- bump_version_on_update trigger on every UPDATE. Hooks pass the
  -- version they read in their WHERE clause; a mismatch surfaces as a
  -- conflict (SQLSTATE 40001 from the status RPC, empty data array
  -- from direct UPDATEs) instead of silently overwriting a concurrent
  -- write from another tab / device / patient-portal action.
  version integer not null default 1,
  created_at timestamptz default now()
);

-- Payments
create table if not exists payments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  patient_id uuid references patients(id) on delete set null,
  patient text not null,
  initials text not null,
  amount integer not null check (amount > 0),
  date text not null,
  method text default 'Transferencia' check (method in ('Transferencia', 'Efectivo', 'Tarjeta', 'Retiro sin Tarjeta', 'Otro')),
  note text default null,
  color_idx integer default 0,
  -- Optimistic locking (migration 066). Same trigger function as
  -- sessions.version (migration 065). See migration headers for the
  -- threat model — single-author single-entry is the common case but
  -- the Prime Directive forbids silent overwrites of money rows.
  version integer not null default 1,
  created_at timestamptz default now()
);

-- Notes (session notes and general patient notes)
create table if not exists notes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  patient_id uuid references patients(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  title text default '',
  content text default '',
  pinned boolean default false,
  -- Note encryption (migration 017). false → content is plaintext;
  -- true → content holds the base64 ciphertext bundle that
  -- cryptoNotes.js produces.
  encrypted boolean not null default false,
  -- Generated FTS column (migration 071). CASE-skips ciphertext so
  -- the index doesn't tokenize the encrypted base64 bundle. Encrypted
  -- users get an empty content_tsv contribution; their search falls
  -- back to in-memory filtering of the decrypted cache.
  search_tsv tsvector
    generated always as (
      setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
      setweight(
        to_tsvector('spanish',
          case when encrypted then '' else coalesce(content, '') end
        ),
        'B'
      )
    ) stored,
  -- Cover image (migration 074). Optional — when set, the editor
  -- renders the referenced attachment as a hero above the title
  -- and the Notes list shows it as a row thumbnail. ON DELETE SET
  -- NULL keeps the note alive when the underlying attachment goes
  -- away.
  cover_attachment_id uuid references note_attachments(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Note tags (migration 071). label is encrypted under the user's
-- master key when note encryption is enabled. label_hash is a
-- canonical-form HMAC for server-side dedup without leaking the
-- plaintext. RLS: user owns their own tags.
create table if not exists note_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  label_ciphertext text not null,
  label_hash text not null,
  color text,
  created_at timestamptz not null default now(),
  unique (user_id, label_hash)
);

create table if not exists note_tag_links (
  note_id uuid not null references notes(id) on delete cascade,
  tag_id uuid not null references note_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, tag_id)
);

-- Note version history (migration 072). Every successful save
-- snapshots into a row here. The snapshot_note RPC owns debounce
-- (60s collapse) + cap (50 versions per note) atomically so the
-- timeline stays usable + storage bounded.
create table if not exists note_versions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes(id) on delete cascade,
  user_id uuid not null,
  version_no int not null,
  title_ciphertext text,
  content_ciphertext text,
  encrypted boolean not null default false,
  created_at timestamptz not null default now(),
  unique (note_id, version_no)
);

-- Note attachments (migration 073). Inline media (images for v1)
-- owned by a single note. Kept separate from `documents` for the
-- usual Prime Directive isolation reasons: documents are billing
-- artefacts that feed expedientes; note attachments are inline
-- media. Mixing them tangles cascades, permissions, and audit.
-- R2 path lives under notes/<userId>/<noteId>/<uuid>. When the
-- user has note encryption unlocked at upload time the client
-- encrypts bytes with the master AES-GCM key and stores the
-- per-attachment IV here; the read path then fetches + decrypts
-- rather than embedding the presigned URL.
create table if not exists note_attachments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes(id) on delete cascade,
  user_id uuid not null,
  r2_path text not null,
  mime text not null,
  size_bytes integer,
  width integer,
  height integer,
  encrypted boolean not null default false,
  iv text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Documents (file metadata; actual files stored in R2)
create table if not exists documents (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  patient_id uuid references patients(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  name text not null,
  file_path text not null unique,
  file_type text default 'application/octet-stream',
  file_size integer,
  kind text not null default 'patient' check (kind in ('patient','receipt')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Recurring expense templates. Day-of-month is clamped to the last day of
-- short months at generation time (28/29 Feb, 30 Apr/Jun/Sep/Nov). Pause
-- via active=false; reactivation does NOT backfill the pause window.
create table if not exists recurring_expenses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  amount integer not null check (amount > 0),
  category text not null,
  description text,
  day_of_month smallint not null check (day_of_month between 1 and 31),
  payment_method text,
  tax_treatment text not null default 'deductible'
    check (tax_treatment in ('deductible','non_deductible','personal')),
  active boolean not null default true,
  start_year smallint not null,
  start_month smallint not null check (start_month between 1 and 12),
  paused_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Expenses (money-out ledger). Recurring-generated rows carry
-- (recurring_id, period_year, period_month) and are deduplicated by the
-- partial unique index uniq_expenses_recurring_period — same pattern as
-- uniq_sessions_patient_date_time. Receipts are stored as documents rows
-- with kind='receipt'; deletion is handled in the hook layer (delete the
-- document + R2 object before deleting the expense).
create table if not exists expenses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  amount integer not null check (amount > 0),
  date text not null,
  category text not null check (category in (
    'consultorio','servicios','software','insumos','formacion',
    'honorarios','transporte','marketing','comisiones','impuestos','otro'
  )),
  description text,
  payment_method text check (payment_method in ('Transferencia','Efectivo','Tarjeta','Otro')),
  tax_treatment text not null default 'deductible'
    check (tax_treatment in ('deductible','non_deductible','personal')),
  cfdi_uuid text,
  cfdi_url text,
  recurring_id uuid references recurring_expenses(id) on delete set null,
  period_year smallint,
  period_month smallint check (period_month is null or period_month between 1 and 12),
  receipt_document_id uuid references documents(id) on delete set null,
  note text,
  color_idx integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Patient-initiated session reschedule requests. Until the therapist
-- accepts (in-app or via email-link), the request lives here without
-- touching the underlying sessions row. One pending per session
-- enforced by uniq_one_pending_per_session below. Tokens auth the
-- email-link two-step flow without requiring a JWT.
create table if not exists session_reschedule_requests (
  id uuid default gen_random_uuid() primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid not null,
  patient_id uuid not null references patients(id) on delete cascade,
  submitted_by uuid not null,
  original_date text not null,
  original_time text not null,
  proposed_date text not null,
  proposed_time text not null,
  patient_note text,
  therapist_note text,
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected','withdrawn','expired')),
  resolved_at timestamptz,
  resolved_by text
    check (resolved_by is null
      or resolved_by in ('therapist_app','therapist_email','patient_withdraw','auto_expire','auto_session_moved')),
  expires_at timestamptz not null,
  approve_token text,
  reject_token text,
  created_at timestamptz default now()
);

-- Bug reports (submitted from in-app bug reporter)
create table if not exists bug_reports (
  id uuid default gen_random_uuid() primary key,
  user_id uuid,
  user_email text,
  description text,
  screen text,
  logs jsonb,
  user_agent text,
  created_at timestamptz default now(),
  archived_at timestamptz
);

-- Push subscriptions (one row per device per user)
create table if not exists push_subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

-- Notification preferences (one row per user)
create table if not exists notification_preferences (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null unique,
  enabled boolean default true,
  reminder_minutes integer default 30,
  timezone text default 'America/Mexico_City',
  updated_at timestamptz default now()
);

-- Sent reminders (deduplication — one per session per user)
create table if not exists sent_reminders (
  id uuid default gen_random_uuid() primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid not null,
  sent_at timestamptz default now(),
  unique(session_id, user_id)
);

-- Tutor-reminder dedupe ledger. Mirrors sent_reminders but keyed on
-- (user, patient, kind, cycle_anchor_date) — one row per "tutor_due" /
-- "tutor_overdue_7" event so the 5-min cron in send-session-reminders
-- doesn't re-notify the tutor on every tick. Created in migration 075.
create table if not exists sent_tutor_reminders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  kind text not null check (kind in ('tutor_due', 'tutor_overdue_7')),
  cycle_anchor_date text not null,
  sent_at timestamptz default now(),
  unique (user_id, patient_id, kind, cycle_anchor_date)
);

-- Anthropometric measurements (nutritionist + trainer). One row per
-- visit/check-in. Schema mirrors migration 024_measurements.sql.
create table if not exists measurements (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  patient_id uuid not null references patients(id) on delete cascade,
  taken_at date not null,
  weight_kg     numeric(5,2),
  waist_cm      numeric(5,2),
  hip_cm        numeric(5,2),
  body_fat_pct  numeric(4,2),
  notes         text default '',
  created_at    timestamptz default now()
);

-- User profession (multi-profession expansion). Locked at sign-up,
-- admin-changeable. The check constraint mirrors PROFESSION in
-- src/data/constants.js.
create table if not exists user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profession text not null check (profession in (
    'psychologist', 'nutritionist', 'tutor', 'music_teacher', 'trainer'
  )),
  -- Acquisition source captured during signup onboarding (step 2 after
  -- profession). Canonical values mirror SIGNUP_SOURCE in
  -- src/data/constants.js. signup_source_detail is only populated
  -- when source = 'other'. Nullable so users created before
  -- migration 042 stay valid.
  signup_source text check (
    signup_source is null
    or signup_source in ('instagram','facebook','tiktok','google','colleague','podcast','event','other')
  ),
  signup_source_detail text check (
    signup_source_detail is null
    or (signup_source = 'other' and length(signup_source_detail) <= 60)
  ),
  signup_source_recorded_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Admin-issued discount codes (influencer / partner promos). The
-- code resolves to a Stripe Coupon + Promotion Code pair so the
-- discount auto-applies at checkout when the visitor arrives via
-- /c/<code>. Manual entry of the same code at the Stripe Checkout
-- promo-code field also works (we set allow_promotion_codes:true).
-- See migration 043 for full RLS + canonical column docs.
create table if not exists influencer_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{4,20}$'),
  stripe_coupon_id text not null,
  stripe_promotion_code_id text not null,
  influencer_name text,
  percent_off integer not null check (percent_off >= 1 and percent_off <= 100),
  duration text not null check (duration in ('once', 'repeating', 'forever')),
  duration_in_months integer check (
    (duration <> 'repeating' and duration_in_months is null)
    or (duration = 'repeating' and duration_in_months between 1 and 12)
  ),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  notes text
);

-- ============================================================
-- Groups (Grupos) — group sessions / classes (migration 076)
-- ============================================================
-- A group is a recurring schedule template (`groups`) plus a roster
-- (`group_members`). A group occurrence FANS OUT into one ordinary
-- `sessions` row per ACTIVE member, all sharing (group_id, date, time),
-- each carrying the flat group rate. Group sessions are ordinary sessions
-- in every accounting respect (real patient_id + rate), so the entire money
-- pipeline folds them in with zero changes. Groups carry no denormalized
-- financial counters; group finances are a derived rollup only.
create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color_idx integer default 0,
  -- Recurring slot template (nullable day/time for episodic / one-off groups).
  day text,
  time text,
  duration integer default 60 check (duration > 0),
  -- Flat group rate applied to every member; null falls back to patient.rate.
  rate integer check (rate is null or rate >= 0),
  modality text default 'presencial'
    check (modality in ('presencial', 'virtual', 'telefonica', 'a-domicilio')),
  recurrence_frequency text not null default 'weekly'
    check (recurrence_frequency in ('weekly', 'biweekly', 'monthly')),
  scheduling_mode text not null default 'recurring'
    check (scheduling_mode in ('recurring', 'episodic')),
  status text not null default 'active' check (status in ('active', 'ended')),
  -- Optimistic locking via the shared bump_version_on_update trigger.
  version integer not null default 1,
  created_at timestamptz default now(),
  constraint groups_name_nonempty check (length(btrim(name)) > 0)
);

drop trigger if exists groups_bump_version on groups;
create trigger groups_bump_version
  before update on groups
  for each row execute function public.bump_version_on_update();

-- Roster. Pure relationship data (no money) so both FKs cascade. Session
-- rows survive group/patient deletion via their own ON DELETE SET NULL —
-- that asymmetry protects financial history. left_at null = active member.
create table if not exists group_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  joined_at timestamptz default now(),
  left_at timestamptz default null,
  created_at timestamptz default now()
);

-- Group tag on sessions / notes / documents. ON DELETE SET NULL everywhere
-- so deleting a group detaches but never destroys. Added via alter because
-- the referenced `groups` table is defined in this section, after the
-- sessions/notes/documents create-table blocks above.
alter table sessions   add column if not exists group_id uuid references groups(id) on delete set null;
alter table notes       add column if not exists group_id uuid references groups(id) on delete set null;
alter table documents   add column if not exists group_id uuid references groups(id) on delete set null;

-- ============================================================
-- Constraint hardening (migration 067)
-- ============================================================
-- Invariants that already live in JS — moved into the schema so a buggy
-- client (current or future) can't corrupt the database. See migration
-- 067 for the audit + rationale. `if not exists` keeps a fresh-DB
-- bootstrap idempotent against re-running schema.sql.
do $$ begin
  -- Patients counter non-negativity
  if not exists (select 1 from pg_constraint where conname='patients_paid_nonneg' and conrelid='public.patients'::regclass)
    then alter table patients add constraint patients_paid_nonneg check (paid >= 0); end if;
  if not exists (select 1 from pg_constraint where conname='patients_billed_nonneg' and conrelid='public.patients'::regclass)
    then alter table patients add constraint patients_billed_nonneg check (billed >= 0); end if;
  if not exists (select 1 from pg_constraint where conname='patients_sessions_nonneg' and conrelid='public.patients'::regclass)
    then alter table patients add constraint patients_sessions_nonneg check (sessions >= 0); end if;
  -- Session physical soundness
  if not exists (select 1 from pg_constraint where conname='sessions_rate_nonneg' and conrelid='public.sessions'::regclass)
    then alter table sessions add constraint sessions_rate_nonneg check (rate is null or rate >= 0); end if;
  if not exists (select 1 from pg_constraint where conname='sessions_duration_positive' and conrelid='public.sessions'::regclass)
    then alter table sessions add constraint sessions_duration_positive check (duration is not null and duration > 0); end if;
  -- Non-empty text on identity columns
  if not exists (select 1 from pg_constraint where conname='patients_name_nonempty' and conrelid='public.patients'::regclass)
    then alter table patients add constraint patients_name_nonempty check (length(name) > 0); end if;
  if not exists (select 1 from pg_constraint where conname='patients_initials_nonempty' and conrelid='public.patients'::regclass)
    then alter table patients add constraint patients_initials_nonempty check (length(initials) > 0); end if;
  if not exists (select 1 from pg_constraint where conname='sessions_patient_nonempty' and conrelid='public.sessions'::regclass)
    then alter table sessions add constraint sessions_patient_nonempty check (length(patient) > 0); end if;
  if not exists (select 1 from pg_constraint where conname='sessions_initials_nonempty' and conrelid='public.sessions'::regclass)
    then alter table sessions add constraint sessions_initials_nonempty check (length(initials) > 0); end if;
  if not exists (select 1 from pg_constraint where conname='payments_patient_nonempty' and conrelid='public.payments'::regclass)
    then alter table payments add constraint payments_patient_nonempty check (length(patient) > 0); end if;
  if not exists (select 1 from pg_constraint where conname='payments_initials_nonempty' and conrelid='public.payments'::regclass)
    then alter table payments add constraint payments_initials_nonempty check (length(initials) > 0); end if;
  -- Date format ("D-MMM" with Spanish 3-letter month, optional "-YY")
  if not exists (select 1 from pg_constraint where conname='sessions_date_format' and conrelid='public.sessions'::regclass)
    then alter table sessions add constraint sessions_date_format check (date ~ '^([1-9]|[12][0-9]|3[01])-(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)(-[0-9]{2})?$'); end if;
  if not exists (select 1 from pg_constraint where conname='payments_date_format' and conrelid='public.payments'::regclass)
    then alter table payments add constraint payments_date_format check (date ~ '^([1-9]|[12][0-9]|3[01])-(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)(-[0-9]{2})?$'); end if;
  if not exists (select 1 from pg_constraint where conname='expenses_date_format' and conrelid='public.expenses'::regclass)
    then alter table expenses add constraint expenses_date_format check (date ~ '^([1-9]|[12][0-9]|3[01])-(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)(-[0-9]{2})?$'); end if;
  -- Time format ("HH:MM" 24h)
  if not exists (select 1 from pg_constraint where conname='sessions_time_format' and conrelid='public.sessions'::regclass)
    then alter table sessions add constraint sessions_time_format check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'); end if;
end $$;

-- ============================================================
-- Indexes
-- ============================================================
create index if not exists idx_patients_user_id on patients(user_id);
create index if not exists idx_sessions_user_id on sessions(user_id);
create index if not exists idx_sessions_patient_id on sessions(patient_id);
create index if not exists idx_sessions_session_type on sessions(session_type);
-- NOTE: the composite (user_id, date) index lives in migration 079 as a
-- forward-looking, NOT-YET-APPLIED change (CONCURRENTLY can't run in the
-- wrapped migration runner, so it's applied out-of-band via the Management
-- API). It is intentionally absent here because schema.sql mirrors the
-- CURRENTLY-APPLIED live schema — adding it before it exists in prod would
-- make schema.sql disagree with the live snapshot. Move this line in (and
-- regenerate schema.snapshot.json) in the same change that applies it.
-- One session per (patient, date, time). DB-level guard against dupes;
-- client-side dedup alone has proven unreliable (stale state across tabs,
-- date-only comparisons, regen paths re-inserting cancelled slots).
-- Partial on patient_id NOT NULL because the column is nullable.
create unique index if not exists uniq_sessions_patient_date_time
  on sessions (patient_id, date, time) where patient_id is not null;
-- Slot uniqueness — two scheduled sessions can't share a therapist's
-- exact slot. Closes the TOCTOU race in the patient-reschedule and
-- therapist-agenda paths; cancelled / completed / charged rows are
-- intentionally outside the partial WHERE clause so historical
-- collisions stay legal. Group rows (group_id IS NOT NULL) are excluded
-- because a group occurrence deliberately puts N members on one slot
-- (migration 076) — member-level dedup is covered by
-- uniq_sessions_patient_date_time.
create unique index if not exists uniq_sessions_user_slot
  on sessions(user_id, date, time) where status = 'scheduled' and group_id is null;
create index if not exists idx_payments_user_id on payments(user_id);
create index if not exists idx_payments_patient_id on payments(patient_id);
create index if not exists idx_notes_user_id on notes(user_id);
create index if not exists idx_notes_patient_id on notes(patient_id);
-- FTS (migration 071) — GIN over the generated tsvector. Encrypted
-- rows contribute only the title weight; the body weight is empty.
create index if not exists notes_search_tsv_idx on notes using gin (search_tsv);
create index if not exists idx_note_tags_user_id on note_tags(user_id);
create index if not exists idx_note_tag_links_tag_id on note_tag_links(tag_id);
create index if not exists idx_note_versions_note_created on note_versions(note_id, created_at desc);
create index if not exists idx_note_attachments_note on note_attachments(note_id) where deleted_at is null;
create index if not exists idx_note_attachments_user_created on note_attachments(user_id, created_at desc) where deleted_at is null;
create index if not exists idx_notes_cover_attachment on notes(cover_attachment_id) where cover_attachment_id is not null;
create index if not exists idx_documents_user_id on documents(user_id);
create index if not exists idx_documents_patient_id on documents(patient_id);
create index if not exists idx_documents_user_kind on documents(user_id, kind);
-- Groups (migration 076)
create index if not exists idx_groups_user_id on groups(user_id);
create index if not exists idx_group_members_group_id   on group_members(group_id);
create index if not exists idx_group_members_patient_id on group_members(patient_id);
create index if not exists idx_group_members_user_id     on group_members(user_id);
create unique index if not exists uniq_group_member_active
  on group_members (group_id, patient_id) where left_at is null;
create index if not exists idx_sessions_group_id
  on sessions(group_id) where group_id is not null;
create index if not exists idx_sessions_group_occurrence
  on sessions(group_id, date, time) where group_id is not null;
create index if not exists idx_notes_group_id
  on notes(group_id) where group_id is not null;
create index if not exists idx_documents_group_id
  on documents(group_id) where group_id is not null;
create unique index if not exists uniq_expenses_recurring_period
  on expenses(recurring_id, period_year, period_month)
  where recurring_id is not null;
create index if not exists idx_expenses_user_id on expenses(user_id);
create index if not exists idx_expenses_user_date on expenses(user_id, date);
create index if not exists idx_expenses_category on expenses(user_id, category);
create index if not exists idx_recurring_expenses_user_id on recurring_expenses(user_id);
create index if not exists idx_bug_reports_created_at on bug_reports(created_at);
create index if not exists idx_push_subscriptions_user_id on push_subscriptions(user_id);
create index if not exists idx_notification_preferences_user_id on notification_preferences(user_id);
create index if not exists idx_sent_reminders_user_id on sent_reminders(user_id);
create index if not exists idx_sent_reminders_session_id on sent_reminders(session_id);
create index if not exists idx_sent_tutor_reminders_user_id on sent_tutor_reminders(user_id);
create index if not exists idx_sent_tutor_reminders_patient_id on sent_tutor_reminders(patient_id);
create index if not exists idx_user_profiles_profession on user_profiles(profession);
create index if not exists idx_measurements_patient on measurements(patient_id, taken_at desc);
create index if not exists idx_measurements_user_id on measurements(user_id);
create unique index if not exists uniq_one_pending_per_session
  on session_reschedule_requests(session_id) where status = 'pending';
create unique index if not exists uniq_reschedule_approve_token
  on session_reschedule_requests(approve_token) where approve_token is not null;
create unique index if not exists uniq_reschedule_reject_token
  on session_reschedule_requests(reject_token) where reject_token is not null;
create index if not exists idx_reschedule_pending
  on session_reschedule_requests(user_id, status, expires_at) where status = 'pending';

-- ============================================================
-- Row Level Security (each user only sees their own data)
-- ============================================================
alter table patients enable row level security;
alter table sessions enable row level security;
alter table payments enable row level security;
alter table notes enable row level security;
alter table documents enable row level security;
alter table expenses enable row level security;
alter table recurring_expenses enable row level security;
alter table session_reschedule_requests enable row level security;
alter table bug_reports enable row level security;
alter table push_subscriptions enable row level security;
alter table notification_preferences enable row level security;
alter table sent_reminders enable row level security;
alter table sent_tutor_reminders enable row level security;
alter table user_profiles enable row level security;
alter table measurements enable row level security;
alter table note_tags enable row level security;
alter table note_tag_links enable row level security;
alter table note_versions enable row level security;
alter table note_attachments enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;

create policy "Users manage own patients" on patients for all using (auth.uid() = user_id);
create policy "Users manage own sessions" on sessions for all using (auth.uid() = user_id);
create policy "Users manage own payments" on payments for all using (auth.uid() = user_id);
create policy "Users manage own notes" on notes for all using (auth.uid() = user_id);
create policy "Users manage own documents" on documents for all using (auth.uid() = user_id);
create policy "Users manage own expenses" on expenses for all using (auth.uid() = user_id);
create policy "Users manage own recurring expenses" on recurring_expenses for all using (auth.uid() = user_id);
create policy "Users manage own push subscriptions" on push_subscriptions for all using (auth.uid() = user_id);
create policy "Users manage own notification preferences" on notification_preferences for all using (auth.uid() = user_id);
create policy "Users read own sent reminders" on sent_reminders for select using (auth.uid() = user_id);
create policy "Users read own sent tutor reminders" on sent_tutor_reminders for select using (auth.uid() = user_id);
create policy "Users read own profile"   on user_profiles for select using (auth.uid() = user_id);
create policy "Users insert own profile" on user_profiles for insert with check (auth.uid() = user_id);
create policy "Users update own profile" on user_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own measurements" on measurements for all using (auth.uid() = user_id);
create policy "Users manage own groups" on groups for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own group members" on group_members for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Note tags (migration 071). Link table's owner is derived from the
-- referenced tag, which is owned by auth.uid() — keeps the RLS shape
-- simple while preventing cross-user link insertion.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='note_tags' and policyname='note_tags_owner') then
    create policy note_tags_owner on note_tags
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='note_tag_links' and policyname='note_tag_links_owner') then
    create policy note_tag_links_owner on note_tag_links
      for all using (
        exists (select 1 from note_tags t where t.id = tag_id and t.user_id = auth.uid())
      ) with check (
        exists (select 1 from note_tags t where t.id = tag_id and t.user_id = auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='note_versions' and policyname='note_versions_owner') then
    create policy note_versions_owner on note_versions
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='note_attachments' and policyname='note_attachments_owner') then
    create policy note_attachments_owner on note_attachments
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

-- Bug reports: any authenticated user can insert; only admin can read/manage
create policy "Users insert own bug reports" on bug_reports for insert with check (auth.uid() is not null);
create policy "Users read own bug reports" on bug_reports for select using (auth.uid() = user_id);

-- Admin read-only access (can view all users' data)
create or replace function is_admin() returns boolean as $$
begin
  return auth.jwt() ->> 'email' = 'gaxioladiego@gmail.com';
end;
$$ language plpgsql security definer;

create policy "Admin reads all patients" on patients for select using (is_admin());
create policy "Admin reads all sessions" on sessions for select using (is_admin());
create policy "Admin reads all payments" on payments for select using (is_admin());
create policy "Admin reads all notes" on notes for select using (is_admin());
create policy "Admin reads all documents" on documents for select using (is_admin());
create policy "Admin reads all expenses" on expenses for select using (is_admin());
create policy "Admin reads all recurring expenses" on recurring_expenses for select using (is_admin());
create policy "Admin reads all groups" on groups for select using (is_admin());
create policy "Admin reads all group members" on group_members for select using (is_admin());
create policy "Therapist reads own reschedule requests"
  on session_reschedule_requests for select using (auth.uid() = user_id);
create policy "Patient reads requests for own patient row"
  on session_reschedule_requests for select using (
    exists (select 1 from patients p
      where p.id = session_reschedule_requests.patient_id
        and p.patient_user_id = auth.uid())
  );
create policy "Admin reads all reschedule requests"
  on session_reschedule_requests for select using (is_admin());
create policy "Admin manages all bug reports" on bug_reports for all using (is_admin());
create policy "Admin reads all push subscriptions" on push_subscriptions for select using (is_admin());
create policy "Admin reads all notification preferences" on notification_preferences for select using (is_admin());
create policy "Admin reads all sent tutor reminders" on sent_tutor_reminders for select using (is_admin());
create policy "Admin reads all profiles" on user_profiles for select using (is_admin());
create policy "Admin updates all profiles" on user_profiles for update using (is_admin()) with check (is_admin());
create policy "Admin reads all measurements" on measurements for select using (is_admin());

-- Admin helper: archive bug reports (bypasses RLS via security definer)
create or replace function archive_bug_reports(report_ids uuid[])
returns void as $$
begin
  if not is_admin() then
    raise exception 'Unauthorized';
  end if;
  update bug_reports set archived_at = now() where id = any(report_ids);
end;
$$ language plpgsql security definer;

-- Admin helper: block/unblock a user by writing auth.users.banned_until
-- directly. Called from /api/admin-block-user via the service-role
-- client; execution is revoked from anon/authenticated so nothing
-- browser-side can hit it via PostgREST.
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

-- Admin helper: fetch user profiles (email + name + ban state) from
-- auth.users. banned_until powers the "Bloqueado" badge in the admin
-- panel; blocking is performed server-side via /api/admin-block-user.
create or replace function get_user_profiles()
returns table(
  id uuid,
  email text,
  full_name text,
  banned_until timestamptz,
  created_at timestamptz,
  profession text,
  is_patient boolean
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
      up.profession::text,
      exists(
        select 1 from patients p
        where p.patient_user_id = au.id
      ) as is_patient
    from auth.users au
    left join user_profiles up on up.user_id = au.id;
end;
$$ language plpgsql security definer;

-- Admin audit log (migration 045). Every action through /api/admin-*
-- writes a row here for compliance. is_admin() RLS for SELECT;
-- writes go via service-role client only.
create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  target_user_id uuid,
  action text not null,
  payload jsonb,
  ip text,
  ua text,
  created_at timestamptz not null default now()
);

-- Revenue overview RPC (migration 046). Single-snapshot JSON for the
-- /admin/revenue page. is_admin() gated. Mirrors useSubscription.js
-- isPro semantics for the active-sub count.

-- Admin saved views (migration 063). Shared filter presets across the
-- admin team for the per-screen AdminFilterBar dropdown. is_admin() on
-- every operation (read+write); no per-row ownership gate so any
-- admin can edit/delete any view.
create table if not exists admin_saved_views (
  id uuid primary key default gen_random_uuid(),
  screen text not null check (screen in (
    'users', 'audit', 'revenue', 'acquisition', 'codes', 'reports'
  )),
  name text not null check (length(name) between 1 and 60),
  filter_state jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_saved_views_filter_state_size
    check (octet_length(filter_state::text) <= 4096)
);
create index if not exists idx_admin_saved_views_screen_created
  on admin_saved_views (screen, created_at desc);
alter table admin_saved_views enable row level security;
create policy "Admin reads saved views"
  on admin_saved_views for select using (is_admin());
create policy "Admin inserts saved views"
  on admin_saved_views for insert with check (is_admin());
create policy "Admin updates saved views"
  on admin_saved_views for update using (is_admin()) with check (is_admin());
create policy "Admin deletes saved views"
  on admin_saved_views for delete using (is_admin());

-- User ratings (migration 048). 1-5 star + optional comment captured
-- via the in-app sheet at structured prompts (day_14_v1 today;
-- day_30_v1 fallback). prompt_kind is free-text so new prompt
-- occasions don't require migrations.
create table if not exists user_ratings (
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt_kind text not null,
  stars smallint not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  primary key (user_id, prompt_kind)
);
create index if not exists idx_user_ratings_kind_created
  on user_ratings(prompt_kind, created_at desc);
alter table user_ratings enable row level security;
create policy "Users insert own ratings"
  on user_ratings for insert
  with check (auth.uid() = user_id);
create policy "Users read own ratings"
  on user_ratings for select
  using (auth.uid() = user_id);
create policy "Admin reads all ratings"
  on user_ratings for select
  using (is_admin());

-- Patient portal — patient-side RLS (migrations 050 + 052).
-- Therapist-side policies above are unchanged; these grant SELECT
-- to a patient on the rows linked to their auth.uid() via
-- patient_user_id, AND only while the relationship is active
-- (status in 'active' or 'potential'). Discarded / ended
-- patients lose portal access automatically — archiving in the
-- therapist app is the kill-switch.
--
-- user_profiles intentionally has NO patient policy. The patient
-- reads therapist info exclusively through the security-definer
-- get_therapists_for_patient() RPC, which returns only safe
-- columns (no signup_source / acquisition metadata).
create policy "Patients read own patient row"
  on patients for select
  using (
    patient_user_id = auth.uid()
    and status in ('active', 'potential')
  );
create policy "Patients read own sessions"
  on sessions for select
  using (
    patient_id in (
      select id from patients
      where patient_user_id = auth.uid()
        and status in ('active', 'potential')
    )
  );
create policy "Patients read own payments"
  on payments for select
  using (
    patient_id in (
      select id from patients
      where patient_user_id = auth.uid()
        and status in ('active', 'potential')
    )
  );

-- Single-call data fetcher for the patient shell (migration 050,
-- hardened in 052). Returns one row per linked-patients-row,
-- joined with auth.users + user_profiles. security definer because
-- auth.users is normally service-role only; the WHERE clause
-- (patient_user_id = auth.uid() + status in active/potential) is
-- the security boundary.
drop function if exists get_therapists_for_patient();

create function get_therapists_for_patient()
returns table (
  patient_id uuid,
  therapist_user_id uuid,
  therapist_email text,
  therapist_full_name text,
  therapist_profession text,
  therapist_avatar text,
  therapist_accepts_online_payments boolean
) as $$
  select
    p.id,
    p.user_id,
    au.email::text,
    coalesce(au.raw_user_meta_data->>'full_name', '')::text,
    coalesce(up.profession, 'psychologist')::text,
    coalesce(au.raw_user_meta_data->>'avatar', '')::text,
    coalesce(tca.charges_enabled, false)
  from patients p
  join auth.users au on au.id = p.user_id
  left join user_profiles up on up.user_id = p.user_id
  left join therapist_connect_accounts tca on tca.user_id = p.user_id
  where p.patient_user_id = auth.uid()
    and p.status in ('active', 'potential');
$$ language sql security definer;

-- ── Stripe Connect (migration 054) ──
-- Therapist's Connect Express account state, populated by the
-- /api/stripe-connect-onboard endpoint and refreshed by the
-- account.updated webhook. RLS scopes SELECT to the owning therapist;
-- writes are service-role only.
create table if not exists therapist_connect_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_account_id text not null unique,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  -- Stale-write guard for the live-refresh path in
  -- /api/stripe-connect-status. The webhook stamps this column on
  -- every account.updated; the status endpoint only overwrites when
  -- its fetch timestamp is strictly newer.
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table therapist_connect_accounts enable row level security;

create policy "Therapist reads own connect account"
  on therapist_connect_accounts for select
  using (user_id = auth.uid());

-- Per-attempt ledger of patient-initiated payments. The Stripe
-- webhook is the source of truth for status — clients never write.
-- payment_id links the row back to the canonical `payments` row that
-- the webhook inserts on success, so the therapist's finanzas tab
-- can show online-payment provenance without scattering money math.
create table if not exists patient_payment_intents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  therapist_user_id uuid not null references auth.users(id) on delete cascade,
  -- ON DELETE CASCADE so a deleted patient's PI rows go with them
  -- (the canonical payments-table record on the therapist side
  -- survives via its own user_id = therapist). Without an explicit
  -- ON DELETE rule, the default NO ACTION blocks user deletion as
  -- soon as a patient ever paid (migration 056).
  paid_by_user_id uuid not null references auth.users(id) on delete cascade,
  stripe_payment_intent_id text not null unique,
  stripe_account_id text not null,
  amount_cents int not null check (amount_cents > 0),
  currency text not null default 'mxn',
  status text not null default 'pending'
    check (status in ('pending','processing','succeeded','failed','canceled')),
  payment_id uuid references payments(id) on delete set null,
  created_at timestamptz not null default now(),
  succeeded_at timestamptz
);

create index if not exists idx_ppi_patient on patient_payment_intents(patient_id);
create index if not exists idx_ppi_therapist on patient_payment_intents(therapist_user_id);
create index if not exists idx_ppi_paid_by on patient_payment_intents(paid_by_user_id);
create index if not exists idx_ppi_stripe_id on patient_payment_intents(stripe_payment_intent_id);

alter table patient_payment_intents enable row level security;

create policy "Patient reads own payment intents"
  on patient_payment_intents for select
  using (paid_by_user_id = auth.uid());

create policy "Therapist reads incoming payments"
  on patient_payment_intents for select
  using (therapist_user_id = auth.uid());

-- Single-use invite tokens that the therapist generates and shares
-- (migration 051). Plaintext stored only in the URL — DB holds the
-- SHA-256 hash. Therapist reads/writes their own; service-role
-- handles the claim-time updates.
create table if not exists patient_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  token_prefix text not null,
  patient_id uuid not null references patients(id) on delete cascade,
  therapist_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '30 days'),
  used_at timestamptz,
  -- ON DELETE SET NULL preserves the audit trail (was-the-invite-used)
  -- when the claiming user is deleted. Without the explicit rule, the
  -- default NO ACTION blocked auth.users deletes for any patient that
  -- ever claimed an invite (migration 056).
  used_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_patient_invites_patient
  on patient_invites(patient_id);
alter table patient_invites enable row level security;
create policy "Therapists read own invites"
  on patient_invites for select
  using (therapist_id = auth.uid());
create policy "Therapists create invites for their patients"
  on patient_invites for insert
  with check (
    therapist_id = auth.uid()
    and patient_id in (select id from patients where user_id = auth.uid())
  );

-- ============================================================
-- Trigger: auto-withdraw pending reschedule requests when a
-- session's date or time changes. The trigger fires on every
-- mutation of those columns regardless of who initiated it (the
-- therapist's drag-to-move action, applyAccept on a request, a
-- future API endpoint, an admin script). Without this, a stale
-- pending request would sit in the therapist's banner pointing at
-- a session that's no longer where the request expected it.
--
-- Same code as migration 061; mirrored here so a fresh-clone build
-- of the schema reproduces production behavior.
-- ============================================================
create or replace function withdraw_reschedule_requests_on_move()
returns trigger
language plpgsql
as $$
begin
  -- Three transitions invalidate any pending request on this session:
  --   1. date changed (slot moved)
  --   2. time changed (slot moved)
  --   3. status moved out of 'scheduled' (cancelled / completed / charged)
  -- Any of those means the patient's "I want to move 16-May 11:00 →
  -- 23-May 14:00" no longer maps to the session as it stands. Withdraw
  -- so the therapist's banner clears and no one tries to act on a
  -- stale request.
  if (old.date is distinct from new.date)
     or (old.time is distinct from new.time)
     or (old.status = 'scheduled' and new.status is distinct from 'scheduled') then
    update session_reschedule_requests
       set status = 'withdrawn',
           resolved_at = now(),
           resolved_by = 'auto_session_moved',
           approve_token = null,
           reject_token = null
     where session_id = new.id
       and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists sessions_withdraw_reschedule_on_move on sessions;
create trigger sessions_withdraw_reschedule_on_move
after update on sessions
for each row
execute function withdraw_reschedule_requests_on_move();

-- ============================================================
-- Trigger: maintain patient.paid as SUM(payments.amount) for the
-- patient. Removes the JS-side .update({ paid: ... }) calls from
-- usePayments (createPayment / deletePayment / updatePayment) and
-- from api/stripe-webhook.js — the DB now owns the invariant.
--
-- Same code as migration 068; mirrored here so a fresh-clone build
-- of the schema reproduces production behavior. recalcPatientCounters
-- (utils/patients.js) stays as a manual recovery tool.
-- ============================================================
create or replace function public.recalc_patient_paid(p_patient_id uuid)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  update patients
  set paid = coalesce(
    (select sum(amount) from payments where patient_id = p_patient_id),
    0
  )
  where id = p_patient_id;
$$;

create or replace function public.trg_payments_recalc_paid()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT') then
    if new.patient_id is not null then
      perform public.recalc_patient_paid(new.patient_id);
    end if;
  elsif (tg_op = 'UPDATE') then
    if old.patient_id is distinct from new.patient_id then
      if old.patient_id is not null then perform public.recalc_patient_paid(old.patient_id); end if;
      if new.patient_id is not null then perform public.recalc_patient_paid(new.patient_id); end if;
    elsif old.amount is distinct from new.amount then
      if new.patient_id is not null then perform public.recalc_patient_paid(new.patient_id); end if;
    end if;
  elsif (tg_op = 'DELETE') then
    if old.patient_id is not null then perform public.recalc_patient_paid(old.patient_id); end if;
  end if;
  return null;
end;
$$;

drop trigger if exists payments_recalc_paid_after_iud on payments;
create trigger payments_recalc_paid_after_iud
after insert or update or delete on payments
for each row execute function public.trg_payments_recalc_paid();

-- ============================================================
-- Trigger: maintain patient.sessions = COUNT(*) and patient.billed
-- = Σ rate over sessions matching the canonical predicate
-- (sessionCountsTowardBalance in utils/accounting.js).
--
-- The SQL predicate mirrors the JS one and MUST stay in sync —
-- otherwise the trigger and the live amountDue calc disagree, and
-- the audit fires.
--
-- Timezone correctness: looks up the user's tz from
-- notification_preferences (default America/Mexico_City) so the
-- past-scheduled auto-complete boundary matches the user's wall clock.
--
-- Same code as migration 069; mirrored here so a fresh-clone build
-- of the schema reproduces production behavior.
-- ============================================================
create or replace function public.spanish_month_idx(mon text)
returns smallint language sql immutable parallel safe as $$
  select case mon
    when 'Ene' then 1 when 'Feb' then 2 when 'Mar' then 3 when 'Abr' then 4
    when 'May' then 5 when 'Jun' then 6 when 'Jul' then 7 when 'Ago' then 8
    when 'Sep' then 9 when 'Oct' then 10 when 'Nov' then 11 when 'Dic' then 12
  end::smallint;
$$;

create or replace function public.infer_short_date_year(
  m smallint, d smallint, ref timestamptz, p_tz text
) returns smallint language plpgsql immutable parallel safe as $$
declare
  ref_date date := (ref at time zone p_tz)::date;
  ref_year smallint := extract(year from ref_date)::smallint;
  best_year smallint := ref_year;
  best_diff integer := 1000000;
  y smallint;
  cand date;
  diff integer;
begin
  for y in select unnest(array[ref_year - 1, ref_year, ref_year + 1]) loop
    begin
      cand := make_date(y::int, m::int, d::int);
      diff := abs(cand - ref_date);
      if diff < best_diff then best_diff := diff; best_year := y; end if;
    exception when others then null;
    end;
  end loop;
  return best_year;
end;
$$;

-- p_created_at anchors the yearless-date year inference (migration 080):
-- created_at is always within the recurrence window of the true session
-- date, so a past-scheduled row >~6mo old keeps counting instead of being
-- inferred into a future year and silently dropped from `billed` (the C1
-- understatement). Falls back to ref/now when null. MUST stay in sync with
-- utils/accounting.ts::sessionEndMoment + the _cardiTools/audit mirrors.
create or replace function public.session_counts_at(
  p_status text, p_date text, p_time text, p_tz text, ref timestamptz, p_created_at timestamptz default null
) returns boolean language plpgsql immutable parallel safe as $$
declare
  parts text[];
  d_num smallint; mon text; m smallint;
  yr_suffix text; y smallint;
  hh smallint := 0; mm smallint := 0;
  tp text[];
  session_end_local timestamp;
  session_end_at timestamptz;
  anchor timestamptz := coalesce(p_created_at, ref);
begin
  if p_status = 'completed' or p_status = 'charged' then return true; end if;
  if p_status <> 'scheduled' then return false; end if;
  parts := regexp_match(p_date, '^([0-9]+)-(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)(?:-([0-9]{2}))?$');
  if parts is null then return false; end if;
  d_num := parts[1]::smallint;
  mon := parts[2];
  m := public.spanish_month_idx(mon);
  if m is null then return false; end if;
  yr_suffix := parts[3];
  if yr_suffix is not null then
    y := (2000 + yr_suffix::smallint)::smallint;
  else
    y := public.infer_short_date_year(m, d_num, anchor, p_tz);
  end if;
  tp := string_to_array(p_time, ':');
  if array_length(tp, 1) >= 2 then
    hh := tp[1]::smallint; mm := tp[2]::smallint;
  end if;
  begin
    session_end_local := make_timestamp(y::int, m::int, d_num::int, hh::int, mm::int, 0) + interval '1 hour';
  exception when others then return false;
  end;
  session_end_at := session_end_local at time zone p_tz;
  -- "has the slot passed" still compares against now (ref), not the anchor.
  return ref >= session_end_at;
end;
$$;

create or replace function public.recalc_patient_session_counters(p_patient_id uuid)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_patient_rate integer; v_user_id uuid; v_tz text; v_tz_valid boolean;
  v_sessions integer; v_billed integer;
  v_now timestamptz := now();
begin
  select rate, user_id into v_patient_rate, v_user_id from patients where id = p_patient_id;
  if v_user_id is null then return; end if;
  select coalesce(timezone, 'America/Mexico_City') into v_tz
    from notification_preferences where user_id = v_user_id;
  if v_tz is null then v_tz := 'America/Mexico_City'; end if;
  -- Defensive validation (migration 070): a malformed timezone string
  -- in notification_preferences would crash session_counts_at via
  -- `at time zone p_tz`, aborting the triggering UPDATE. Fall back to
  -- the same default to keep writes flowing.
  select exists(select 1 from pg_timezone_names where name = v_tz) into v_tz_valid;
  if not v_tz_valid then v_tz := 'America/Mexico_City'; end if;
  select count(*)::integer into v_sessions from sessions where patient_id = p_patient_id;
  select coalesce(sum(coalesce(s.rate, v_patient_rate, 0)), 0)::integer into v_billed
    from sessions s
    where s.patient_id = p_patient_id
      and public.session_counts_at(s.status, s.date, s.time, v_tz, v_now, s.created_at);
  update patients set sessions = coalesce(v_sessions, 0), billed = coalesce(v_billed, 0)
    where id = p_patient_id;
end;
$$;

create or replace function public.trg_sessions_recalc_counters()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if (tg_op = 'INSERT') then
    if new.patient_id is not null then perform public.recalc_patient_session_counters(new.patient_id); end if;
  elsif (tg_op = 'UPDATE') then
    if old.patient_id is distinct from new.patient_id then
      if old.patient_id is not null then perform public.recalc_patient_session_counters(old.patient_id); end if;
      if new.patient_id is not null then perform public.recalc_patient_session_counters(new.patient_id); end if;
    elsif old.status is distinct from new.status
       or old.date is distinct from new.date
       or old.time is distinct from new.time
       or old.rate is distinct from new.rate then
      if new.patient_id is not null then perform public.recalc_patient_session_counters(new.patient_id); end if;
    end if;
  elsif (tg_op = 'DELETE') then
    if old.patient_id is not null then perform public.recalc_patient_session_counters(old.patient_id); end if;
  end if;
  return null;
end;
$$;

drop trigger if exists sessions_recalc_counters_after_iud on sessions;
create trigger sessions_recalc_counters_after_iud
after insert or update or delete on sessions
for each row execute function public.trg_sessions_recalc_counters();

-- Notes full-text search RPC (migration 071). Wraps the
-- websearch_to_tsquery + ts_rank pattern so JS callers can pass a
-- raw query string and get id + updated_at + rank back. Encrypted
-- notes contribute only the title to the index; callers with
-- encryption enabled should fall back to in-memory filtering of
-- the decrypted cache for body matches.
create or replace function public.search_notes(p_query text, p_limit integer default 10)
returns table (id uuid, updated_at timestamptz, rank real)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select n.id, n.updated_at,
         ts_rank(n.search_tsv, websearch_to_tsquery('spanish', p_query)) as rank
  from notes n
  where n.user_id = auth.uid()
    and n.search_tsv @@ websearch_to_tsquery('spanish', p_query)
  order by rank desc, n.updated_at desc
  limit greatest(1, coalesce(p_limit, 10));
$$;

-- Snapshot a note's current state into note_versions (migration 072).
-- Debounce + cap are handled atomically server-side so the JS caller
-- just fires-and-forgets. Returns the version_no that was written
-- (debounced overwrites return the existing version_no).
create or replace function public.snapshot_note(
  p_note_id uuid,
  p_title_ciphertext text,
  p_content_ciphertext text,
  p_encrypted boolean,
  p_debounce_seconds integer default 60,
  p_cap integer default 50
) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_latest_at timestamptz;
  v_latest_no integer;
  v_next_no integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from notes where id = p_note_id and user_id = v_user_id) then
    raise exception 'note not found' using errcode = 'P0002';
  end if;
  select created_at, version_no into v_latest_at, v_latest_no
  from note_versions
  where note_id = p_note_id
  order by version_no desc
  limit 1;
  if v_latest_at is not null and now() - v_latest_at < make_interval(secs => p_debounce_seconds) then
    update note_versions
    set title_ciphertext = p_title_ciphertext,
        content_ciphertext = p_content_ciphertext,
        encrypted = p_encrypted,
        created_at = now()
    where note_id = p_note_id and version_no = v_latest_no;
    return v_latest_no;
  end if;
  v_next_no := coalesce(v_latest_no, 0) + 1;
  insert into note_versions (note_id, user_id, version_no, title_ciphertext, content_ciphertext, encrypted)
    values (p_note_id, v_user_id, v_next_no, p_title_ciphertext, p_content_ciphertext, p_encrypted);
  delete from note_versions
  where note_id = p_note_id
    and version_no <= v_next_no - greatest(1, coalesce(p_cap, 50));
  return v_next_no;
end;
$$;

-- ── notifications: in-app inbox (durable record of push notifications) ──
-- Written server-side only (cron reminders + admin/system via service role);
-- no user INSERT policy so clients can't fabricate rows. See migration
-- 077_notifications.sql for the full rationale.
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null default 'reminder'
                check (kind in ('reminder','system')),
  title       text not null,
  body        text not null default '',
  url         text default '/',
  session_id  uuid references sessions(id) on delete set null,
  patient_id  uuid references patients(id) on delete set null,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notifications_user_created
  on notifications(user_id, created_at desc);
create index if not exists idx_notifications_unread
  on notifications(user_id) where read = false;
create unique index if not exists uniq_notifications_reminder
  on notifications(user_id, session_id)
  where kind = 'reminder' and session_id is not null;

alter table notifications enable row level security;

create policy "Users read own notifications" on notifications
  for select using (auth.uid() = user_id);
create policy "Users update own notifications" on notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own notifications" on notifications
  for delete using (auth.uid() = user_id);
create policy "Admin reads all notifications" on notifications
  for select using (is_admin());
