-- One per-user opaque token that authorizes read access to a personal
-- iCalendar (.ics) feed of the user's sessions. The token is the only
-- credential needed — calendar clients can't carry a Supabase JWT, so
-- we follow the standard "secret URL" pattern (Google Calendar, iCloud,
-- Outlook all do this for shared feeds).
--
-- Properties of the token:
--   - 32+ bytes of CSPRNG entropy, base64url-encoded
--   - Unguessable but logged-in-readable; user surfaces it in Settings
--   - Rotation = upsert with a fresh value (existing subscriptions break,
--     which is the desired behaviour after a leak)
--   - One active token per user (unique constraint on user_id)
--
-- Anyone with the token can read the user's session list. Patient names
-- are deliberately replaced with initials in the feed body so the
-- exposure surface is small even if a token leaks. Documented in the
-- Settings copy that surfaces the URL.

create table if not exists public.user_calendar_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  -- Exactly one active token per user — rotation overwrites in place
  -- via upsert(on conflict user_id).
  unique (user_id),
  unique (token)
);

alter table public.user_calendar_tokens enable row level security;

drop policy if exists "user_calendar_tokens select own" on public.user_calendar_tokens;
create policy "user_calendar_tokens select own" on public.user_calendar_tokens
  for select using (auth.uid() = user_id);

drop policy if exists "user_calendar_tokens insert own" on public.user_calendar_tokens;
create policy "user_calendar_tokens insert own" on public.user_calendar_tokens
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_calendar_tokens update own" on public.user_calendar_tokens;
create policy "user_calendar_tokens update own" on public.user_calendar_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_calendar_tokens delete own" on public.user_calendar_tokens;
create policy "user_calendar_tokens delete own" on public.user_calendar_tokens
  for delete using (auth.uid() = user_id);

-- The lookup pattern is "find user by token". A unique index on token
-- already exists from the unique constraint above, so no extra index
-- needed. Index on user_id is added for the Settings read.
create index if not exists user_calendar_tokens_user_idx
  on public.user_calendar_tokens (user_id);
