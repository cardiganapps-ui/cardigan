-- 074 — note covers
--
-- Phase E.2 of the Notes premium polish roadmap. Lets a user
-- promote one of a note's attachments to a "cover" — rendered as
-- a hero above the title in the editor and as a thumbnail on the
-- list row.
--
-- Implementation is intentionally minimal: a single nullable FK
-- column on `notes` pointing at `note_attachments.id`. ON DELETE
-- SET NULL so deleting the underlying attachment quietly demotes
-- the cover slot rather than cascading to the note itself.
--
-- Why not derive the cover from "first attachment"? Two reasons:
--   1. Users want control. "Make this one the cover" is a small
--      but specific intent that "first uploaded" doesn't satisfy.
--   2. The visual prominence of a cover means picking it wrongly
--      is more disruptive than picking it correctly is rewarding.
--      Explicit > implicit for a hero slot.
--
-- The list-thumbnail rendering DOES fall back to first attachment
-- when no cover is set — best of both worlds: zero-friction
-- thumbnails for unconfigured notes, deliberate hero for the rest.

alter table notes
  add column if not exists cover_attachment_id uuid
    references note_attachments(id) on delete set null;
create index if not exists idx_notes_cover_attachment
  on notes(cover_attachment_id) where cover_attachment_id is not null;
