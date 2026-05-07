-- ── User ratings (NPS-style, in-app prompt + email-driven) ──
--
-- Cardigan asks every user to rate the product at structured
-- moments (day 14 after signup, day 30 fallback if dismissed). The
-- in-app sheet captures (stars, optional comment); email cohorts
-- deep-link into the same sheet.
--
-- Schema notes:
--   - Composite PK (user_id, prompt_kind) so a user can submit at
--     most one rating per prompt occasion. ON CONFLICT DO UPDATE on
--     the insert path lets the user edit their answer if the prompt
--     re-opens within the same kind window — last write wins.
--   - prompt_kind is free-text rather than an enum so adding new
--     prompt occasions (post-first-month, year-end, etc.) doesn't
--     require a DB migration.
--   - Comment is optional; when stars <= 2 the in-app form makes it
--     required UI-side, but the column allows NULL so a 5-star
--     "everything's great" submit doesn't force typing.
--   - Indexed on (prompt_kind, created_at) for the admin
--     distribution view.

create table if not exists user_ratings (
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt_kind text not null,
  stars smallint not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  primary key (user_id, prompt_kind)
);

create index if not exists idx_user_ratings_kind_created
  on user_ratings(prompt_kind, created_at desc);

alter table user_ratings enable row level security;

-- Owner can read + insert their own. Updates are handled by the
-- service-role API endpoint (re-submit via UPSERT) — we don't expose
-- a direct UPDATE policy because the API is the single funnel.
create policy "Users insert own ratings"
  on user_ratings for insert
  with check (auth.uid() = user_id);

create policy "Users read own ratings"
  on user_ratings for select
  using (auth.uid() = user_id);

create policy "Admin reads all ratings"
  on user_ratings for select
  using (is_admin());
