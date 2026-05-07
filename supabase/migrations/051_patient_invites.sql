-- Patient invite tokens
--
-- Single-use opaque tokens that the therapist generates from a
-- patient's expediente and shares with the patient (typically via
-- WhatsApp in the MX market). Patient taps the link, signs up via
-- standard Supabase Auth, and the claim endpoint stamps
-- `patient_user_id` on the patients row.
--
-- Mirrors the user_calendar_tokens pattern (migration 015): the
-- plaintext token is generated server-side, returned ONCE in the
-- API response, and never recoverable thereafter — only the SHA-256
-- hash is persisted. A leaked DB dump can't surface valid invites.

create table if not exists patient_invites (
  id uuid primary key default gen_random_uuid(),
  -- SHA-256 hex of the plaintext token. The plaintext lives only
  -- in the URL the therapist shares.
  token_hash text not null unique,
  -- 6-char human-readable prefix of the plaintext, for the therapist
  -- to recognize their own pending invites in admin tooling. Not
  -- enough entropy on its own to be a credential.
  token_prefix text not null,
  -- The patients row this invite stamps on claim. Cascade-deleted
  -- if the therapist removes the patient before the patient claims.
  patient_id uuid not null references patients(id) on delete cascade,
  -- Denormalized so the claim endpoint doesn't have to re-resolve
  -- the therapist via patients on every claim.
  therapist_id uuid not null references auth.users(id) on delete cascade,
  -- 30-day TTL — long enough to forgive a WhatsApp thread's normal
  -- delay; short enough that orphaned invites age out before they
  -- become a leak surface.
  expires_at timestamptz not null default (now() + interval '30 days'),
  -- Both null until claimed; both set atomically on a successful
  -- claim. Single-use.
  used_at timestamptz,
  used_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_patient_invites_patient
  on patient_invites(patient_id);

alter table patient_invites enable row level security;

-- Therapist can read + insert their own invites.
-- Service-role handles claim-time updates / deletes — no patient-
-- side policies on this table.
create policy "Therapists read own invites"
  on patient_invites for select
  using (therapist_id = auth.uid());

create policy "Therapists create invites for their patients"
  on patient_invites for insert
  with check (
    therapist_id = auth.uid()
    and patient_id in (select id from patients where user_id = auth.uid())
  );
