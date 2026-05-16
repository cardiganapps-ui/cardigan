-- 071 — notes full-text search + tags
--
-- Phase 1 of the Notes premium roadmap. Two independent additions
-- bundled into one migration because they share the same RLS shape
-- (auth.uid() = user_id) and ship as a single foundation commit.
--
-- ── Full-text search ─────────────────────────────────────────────
--
-- Adds a generated tsvector column over (title, content) with the
-- Spanish dictionary + GIN index. Encryption asymmetry: `content`
-- holds ciphertext when notes.encrypted=true, so the generated
-- column CASE-skips it for encrypted rows (encrypted users keep
-- their existing in-memory filter against the decrypted cache —
-- documented asymmetry, not a bug).
--
-- Weight A = title, weight B = content. Standard ts_rank weighting
-- so a title hit outranks a body hit for the same query.
--
-- ── Tags ─────────────────────────────────────────────────────────
--
-- Two tables: note_tags (user-owned label rows, encrypted under the
-- user's master key when note encryption is enabled) and
-- note_tag_links (many-to-many join). label_hash is an HMAC over
-- the canonical lowercase label so duplicates dedupe without
-- leaking the cleartext server-side. color is a free-text token
-- (constrained client-side to a palette enum).

alter table notes add column if not exists search_tsv tsvector
  generated always as (
    setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
    setweight(
      to_tsvector('spanish',
        case when encrypted then '' else coalesce(content, '') end
      ),
      'B'
    )
  ) stored;

create index if not exists notes_search_tsv_idx on notes using gin (search_tsv);

-- ── Tag tables ──
create table if not exists note_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  label_ciphertext text not null,
  label_hash text not null,
  color text,
  created_at timestamptz not null default now(),
  unique (user_id, label_hash)
);
create index if not exists idx_note_tags_user_id on note_tags(user_id);
alter table note_tags enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='note_tags' and policyname='note_tags_owner') then
    create policy note_tags_owner on note_tags
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

create table if not exists note_tag_links (
  note_id uuid not null references notes(id) on delete cascade,
  tag_id uuid not null references note_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, tag_id)
);
create index if not exists idx_note_tag_links_tag_id on note_tag_links(tag_id);
alter table note_tag_links enable row level security;
-- The link's owner is the tag's owner (which equals the note's
-- owner by data shape). Check tag_id directly — note_id is also
-- owned by the same user via the existing notes RLS.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='note_tag_links' and policyname='note_tag_links_owner') then
    create policy note_tag_links_owner on note_tag_links
      for all using (
        exists (select 1 from note_tags t where t.id = tag_id and t.user_id = auth.uid())
      ) with check (
        exists (select 1 from note_tags t where t.id = tag_id and t.user_id = auth.uid())
      );
  end if;
end $$;

-- ── Search RPC ──
-- Wraps the tsquery + ts_rank pattern so the JS caller doesn't have
-- to construct a websearch_to_tsquery from a raw user string (and
-- doesn't have to handle the rank tie-breaker). Returns id +
-- updated_at + rank ranked descending; client maps ids to local
-- note state for the display row.
--
-- Encrypted users SHOULD NOT call this RPC — their content_tsv is
-- empty for ciphertext rows so results would be incomplete. The
-- CommandPalette gates by useNoteCrypto.status; the RPC just stays
-- correct on the data it sees.
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
