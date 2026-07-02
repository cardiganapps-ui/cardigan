-- ── iOS widget data tokens ──────────────────────────────────────────
--
-- The WidgetKit extension can't carry a Supabase JWT (it runs outside
-- the WebView and JWTs expire hourly), so widget data uses the same
-- "opaque token as credential" model as the calendar feed
-- (015_calendar_tokens + 026_calendar_token_hash), hash-only from day
-- one:
--   - /api/widget-token (JWT-gated) mints/rotates/revokes the token;
--     the plaintext goes out ONCE and is handed to the native shell,
--     which stores it in the App Group container.
--   - /api/widget-data (token-gated) returns the compact snapshot the
--     widgets render. Token travels in the Authorization header, never
--     in the URL.
--
-- Exactly one active token per user; rotation overwrites in place via
-- upsert(on conflict user_id). last_accessed_at lets Settings show
-- whether widgets are actually pulling data before rotating/revoking.
--
-- POST-APPLY: run `node --env-file=.env.local scripts/schema-snapshot.mjs --update`
-- and commit the refreshed supabase/schema.snapshot.json.

create table if not exists public.user_widget_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null,
  token_prefix text,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz
);

create unique index if not exists uniq_user_widget_tokens_hash
  on public.user_widget_tokens (token_hash);

alter table public.user_widget_tokens enable row level security;

-- Users can see their own row (Settings status panel reads via the
-- API today, but keep parity with user_calendar_tokens). All writes
-- go through the service-role client in /api/widget-token.
drop policy if exists "user_widget_tokens select own" on public.user_widget_tokens;
create policy "user_widget_tokens select own" on public.user_widget_tokens
  for select using (auth.uid() = user_id);
