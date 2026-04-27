-- ── Hash calendar feed tokens at rest ───────────────────────────────
--
-- The calendar feed token IS the credential — calendar clients can't
-- carry a JWT. Until now it was stored in plaintext, meaning any read
-- of the user_calendar_tokens table (admin, DB dump, accidental log)
-- yields working subscription URLs.
--
-- This migration:
--   1. Adds token_hash (SHA-256 hex) for lookup.
--   2. Adds token_prefix (first 8 chars of plaintext) for the UI to
--      surface a recognizable identifier without storing the secret.
--   3. Backfills both from the existing plaintext token.
--   4. Adds a unique index on token_hash.
--   5. Drops the token column.
--
-- Existing subscriptions keep working — the feed endpoint hashes the
-- inbound token from the URL and looks up by hash. Users will see
-- only "9bGaXXX..." in Settings going forward; to retrieve a fresh
-- shareable URL they must rotate (which breaks existing subscribers,
-- by design).
--
-- pgcrypto is enabled by default on Supabase; the builtin sha256()
-- on bytea is also available on PG11+ but we use digest() for
-- explicit dependency on pgcrypto.

ALTER TABLE public.user_calendar_tokens
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS token_prefix text;

UPDATE public.user_calendar_tokens
   SET token_hash   = encode(digest(token, 'sha256'), 'hex'),
       token_prefix = substring(token from 1 for 8)
 WHERE token_hash IS NULL
   AND token IS NOT NULL;

ALTER TABLE public.user_calendar_tokens
  ALTER COLUMN token_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_calendar_tokens_hash
  ON public.user_calendar_tokens (token_hash);

-- Drop the plaintext column. After this point the raw token cannot be
-- recovered from the DB — the user only sees it once at create/rotate
-- time in the API response body.
ALTER TABLE public.user_calendar_tokens
  DROP COLUMN IF EXISTS token;
