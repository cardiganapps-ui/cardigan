-- 084 — PBKDF2 iteration-count floor on note-encryption key wraps (WS-11)
--
-- Defense-in-depth for the opt-in note encryption. New passphrase wraps are
-- always derived at 600k iterations (cryptoNotes.ts PBKDF2_ITERS), but a
-- weak/tampered `passphrase_iters` should never be storable. This CHECK
-- bounds the column server-side; the client mirrors it with MIN_PBKDF2_ITERS
-- and fails closed on read. Null-tolerant (rows without a passphrase wrap).
--
-- Safe to apply: user_encryption_keys currently has 0 rows, and every value
-- the app ever writes is 600000 (>= the 100000 floor).

alter table public.user_encryption_keys
  drop constraint if exists chk_passphrase_iters_floor;

alter table public.user_encryption_keys
  add constraint chk_passphrase_iters_floor
  check (passphrase_iters is null or passphrase_iters >= 100000);
