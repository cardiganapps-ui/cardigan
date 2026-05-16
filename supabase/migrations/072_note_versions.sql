-- 072 — note version history
--
-- Phase 2 of the Notes premium roadmap. Every successful save of
-- a note snapshots the new state into a sibling table so users can
-- inspect the timeline, diff against prior versions, and restore
-- if they regret an edit.
--
-- Encryption: snapshots reuse the same envelope as the live notes
-- column. When notes.encrypted = true, title_ciphertext +
-- content_ciphertext hold the AES-GCM bundle from cryptoNotes.js;
-- otherwise plaintext copies. The `encrypted` flag on each row
-- tells the read path which lane to take.
--
-- The snapshot_note RPC owns three concerns atomically:
--   1. Debounce — if the most recent version was created within
--      p_debounce_seconds, UPDATE it in place rather than
--      appending. Stops a user holding-shift-typing from
--      multiplying version rows. Default 60s matches the plan.
--   2. Versioning — version_no is monotonic per note (max+1).
--   3. Cap — after insert, prune to the latest p_cap rows
--      (default 50) so storage growth stays bounded. Two-tier
--      pruning (DELETE WHERE version_no IN (...)) keeps the
--      pruning predicate index-friendly.

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
create index if not exists idx_note_versions_note_created
  on note_versions(note_id, created_at desc);

alter table note_versions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='note_versions' and policyname='note_versions_owner') then
    create policy note_versions_owner on note_versions
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

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

  -- Ownership check via the note's RLS (and explicit too — belt and
  -- suspenders since this function runs SECURITY INVOKER).
  if not exists (select 1 from notes where id = p_note_id and user_id = v_user_id) then
    raise exception 'note not found' using errcode = 'P0002';
  end if;

  select created_at, version_no into v_latest_at, v_latest_no
  from note_versions
  where note_id = p_note_id
  order by version_no desc
  limit 1;

  -- Debounce: rapid successive saves collapse into the same row so
  -- the timeline stays usable (one entry per "thought", not per
  -- keystroke).
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

  -- Cap: keep only the latest p_cap versions per note.
  delete from note_versions
  where note_id = p_note_id
    and version_no <= v_next_no - greatest(1, coalesce(p_cap, 50));

  return v_next_no;
end;
$$;
