-- 073 — note attachments
--
-- Phase 5 of the Notes premium roadmap. Image attachments for
-- notes, stored in R2 under `notes/<userId>/<noteId>/<uuid>` (the
-- prefix is enforced by api/_r2.js::validatePath).
--
-- Why a separate table from `documents`:
--   Prime Directive isolation. The `documents` table is a billing
--   artifact surface (receipts, intake forms, patient files) that
--   feeds expedientes and recibos. Note attachments are inline
--   media owned by a single note. Mixing them would tangle the
--   permissions story, the cascade story, and the audit story.
--   Cheaper to keep them apart from day one.
--
-- Encryption: when the user has note encryption unlocked at
-- upload time, the client encrypts the raw bytes with the same
-- AES-GCM master key the notes use, generates a per-attachment
-- 12-byte IV, and uploads the ciphertext as
-- `application/octet-stream`. The IV is stored separately on the
-- row so we don't need to embed it in the R2 object; the row
-- also flags `encrypted=true` so the read path knows to fetch +
-- decrypt rather than embedding the presigned URL directly.
--
-- Soft delete: `deleted_at` lets the audit script clean up
-- orphaned R2 objects asynchronously. The live UI filters
-- `deleted_at IS NULL` and the hard-delete + R2 purge happens
-- as part of the user's delete action.

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
create index if not exists idx_note_attachments_note
  on note_attachments(note_id) where deleted_at is null;
create index if not exists idx_note_attachments_user_created
  on note_attachments(user_id, created_at desc) where deleted_at is null;

alter table note_attachments enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='note_attachments' and policyname='note_attachments_owner') then
    create policy note_attachments_owner on note_attachments
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;
