-- Migration 042: capture acquisition source during signup.
--
-- Adds three columns to user_profiles so we can attribute each new
-- signup to a marketing channel (Instagram, Google, podcast, etc.).
-- Populated by ProfessionOnboarding's step 2 — a tile picker shown
-- right after the profession picker. Existing users (created before
-- this ships) are NOT backfill-prompted; their rows stay null.
--
-- - signup_source            — canonical enum value (small set; check below)
-- - signup_source_detail     — free-form text only when source = 'other'
-- - signup_source_recorded_at — when the user submitted their answer; the
--                              app's "is this user fully onboarded?" check
--                              keys on this being non-null

alter table user_profiles
  add column if not exists signup_source text,
  add column if not exists signup_source_detail text,
  add column if not exists signup_source_recorded_at timestamptz;

-- Canonical values — keep in sync with SIGNUP_SOURCE in
-- src/data/constants.js. Nullable so legacy rows stay valid.
alter table user_profiles
  drop constraint if exists user_profiles_signup_source_check;
alter table user_profiles
  add constraint user_profiles_signup_source_check
  check (
    signup_source is null
    or signup_source in ('instagram','facebook','tiktok','google','colleague','podcast','event','other')
  );

-- detail only populated when source = 'other'; cap at 60 chars to
-- keep this analytics-friendly and prevent abuse.
alter table user_profiles
  drop constraint if exists user_profiles_signup_source_detail_check;
alter table user_profiles
  add constraint user_profiles_signup_source_detail_check
  check (
    signup_source_detail is null
    or (signup_source = 'other' and length(signup_source_detail) <= 60)
  );

create index if not exists idx_user_profiles_signup_source
  on user_profiles(signup_source);
