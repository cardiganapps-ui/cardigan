-- Per-user note encryption metadata.
--
-- One row per user who has opted in to note encryption. Stores two
-- wrappings of the user's randomly-generated master key:
--
--   passphrase_wrap : AES-GCM(pbkdf2(passphrase, salt) , master_key)
--                     The user's daily-unlock path. The server never
--                     sees the passphrase or the master key — wrap is
--                     produced in the browser via WebCrypto and sent
--                     here as ciphertext.
--
--   recovery_wrap   : RSA-OAEP-2048(pubkey, master_key)
--                     The admin-recovery path. The matching RSA
--                     private key lives in the NOTES_RECOVERY_PRIVATE_KEY
--                     Vercel env var and is read only by the admin
--                     recovery endpoint. A Supabase-only compromise
--                     does NOT yield the master key.
--
-- All wraps are stored base64-encoded in text columns rather than
-- bytea so the Supabase REST surface can read them without escape
-- gymnastics.

create table if not exists public.user_encryption_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Wrap inputs (stored so we can re-derive on unlock).
  passphrase_wrap text not null,
  passphrase_salt text not null,
  passphrase_iv text not null,
  passphrase_iters int not null default 600000,
  -- Recovery wrap. recovery_kid identifies which RSA keypair was used
  -- so we can rotate without losing access to the back catalogue.
  recovery_wrap text not null,
  recovery_kid text not null default 'v1',
  -- Lifecycle.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Exactly one active key per user. Re-wrap (passphrase change,
  -- recovery rotation) overwrites in place via upsert.
  unique (user_id)
);

alter table public.user_encryption_keys enable row level security;

drop policy if exists "user_encryption_keys select own" on public.user_encryption_keys;
create policy "user_encryption_keys select own" on public.user_encryption_keys
  for select using (auth.uid() = user_id);

-- All writes go through the service-role client in api/encryption.js
-- (which verifies the caller's JWT first), so user-direct insert/update
-- via the REST surface stays disabled. We don't add any user-level
-- write policies here intentionally.

-- Admin can read all rows so the recovery RPC can find the wrap. The
-- private key is required to actually decrypt — RLS read alone yields
-- only ciphertext.
drop policy if exists "user_encryption_keys admin select" on public.user_encryption_keys;
create policy "user_encryption_keys admin select" on public.user_encryption_keys
  for select using (public.is_admin());

-- ── notes.encrypted flag ─────────────────────────────────────────────
-- Existing plaintext notes stay plaintext (encrypted = false). New
-- notes from a user with encryption enabled are written as ciphertext
-- with encrypted = true. The flag drives the client's encrypt/decrypt
-- branch on read; it also lets the admin write a one-shot migration
-- that re-encrypts old notes if desired.
alter table public.notes
  add column if not exists encrypted boolean not null default false;

create index if not exists notes_encrypted_user_idx
  on public.notes (user_id) where encrypted = true;
