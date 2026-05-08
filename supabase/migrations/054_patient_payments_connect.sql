-- ── 054_patient_payments_connect.sql ──
-- Stage 3 of the patient portal: in-app payments. Patient pays their
-- therapist via Stripe Connect Express; the therapist receives funds
-- directly (Cardigan never touches the money). Cardigan's revenue
-- stays the SaaS-side $299 MXN/mo subscription — 0% application fee
-- on patient payments.
--
-- This migration adds two tables (Connect-account state for the
-- therapist + a per-payment ledger), updates the patient-side RPC
-- to expose Connect status (so the patient knows whether to show
-- the "Pagar saldo" CTA), and tightens RLS so neither side can write
-- to the new tables directly — only the service role (server
-- endpoints / webhook) does.

-- ── therapist_connect_accounts ──
-- One row per therapist who has started Stripe Connect onboarding.
-- The columns are populated by /api/stripe-connect-onboard at
-- creation time, then refreshed by `account.updated` webhook events
-- as the therapist progresses through onboarding (verifying
-- identity, adding bank details, etc).
--
-- charges_enabled = Stripe will accept payments destined for this
-- account. The patient-side "Pagar saldo" CTA gates on this.
-- payouts_enabled = Stripe will pay out the funds to the therapist's
-- bank. Independent of charges (a brand-new account can sometimes
-- charge before its bank is fully verified).
create table if not exists therapist_connect_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_account_id text not null unique,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table therapist_connect_accounts enable row level security;

create policy "Therapist reads own connect account"
  on therapist_connect_accounts for select
  using (user_id = auth.uid());

-- No INSERT / UPDATE / DELETE policies — service-role only.

-- ── patient_payment_intents ──
-- A row per payment ATTEMPT initiated by a patient. Created in
-- 'pending' status by /api/patient-create-checkout, advanced to
-- 'succeeded' / 'failed' by the Stripe webhook. The webhook is the
-- source of truth — clients never write to this table.
--
-- payment_id links the row back to the canonical `payments` row that
-- the webhook inserts on success. Two reasons:
--   1. The therapist's existing finanzas tab reads from `payments`
--      and must keep doing so — we don't want to scatter the
--      therapist's money math across two tables.
--   2. If a Stripe payment is later refunded / disputed, we can
--      walk back from the payments row to the originating PI.
create table if not exists patient_payment_intents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  -- Denormalized for fast service-side lookups + RLS scoping.
  therapist_user_id uuid not null references auth.users(id) on delete cascade,
  paid_by_user_id uuid not null references auth.users(id),
  stripe_payment_intent_id text not null unique,
  -- The Connect account the PI was created against. Stored so the
  -- webhook handler can verify the event came from the right account
  -- before it advances state.
  stripe_account_id text not null,
  amount_cents int not null check (amount_cents > 0),
  currency text not null default 'mxn',
  status text not null default 'pending'
    check (status in ('pending','processing','succeeded','failed','canceled')),
  payment_id uuid references payments(id) on delete set null,
  created_at timestamptz not null default now(),
  succeeded_at timestamptz
);

create index if not exists idx_ppi_patient on patient_payment_intents(patient_id);
create index if not exists idx_ppi_therapist on patient_payment_intents(therapist_user_id);
create index if not exists idx_ppi_paid_by on patient_payment_intents(paid_by_user_id);
create index if not exists idx_ppi_stripe_id on patient_payment_intents(stripe_payment_intent_id);

alter table patient_payment_intents enable row level security;

-- Patient sees their own attempts (so the home screen can render
-- pending state if they leave + come back mid-checkout).
create policy "Patient reads own payment intents"
  on patient_payment_intents for select
  using (paid_by_user_id = auth.uid());

-- Therapist sees incoming payments — finanzas tab can render an
-- "online payment via Stripe" badge or a pending-state pill while
-- the webhook is still in flight.
create policy "Therapist reads incoming payments"
  on patient_payment_intents for select
  using (therapist_user_id = auth.uid());

-- ── RPC update — expose Connect status to the patient ──
-- The patient-side render gates the "Pagar saldo" CTA on whether
-- the therapist has completed Connect onboarding. Surfacing the
-- single boolean (charges_enabled) through the existing RPC keeps
-- the patient from needing to query a new table directly.
--
-- Postgres won't `CREATE OR REPLACE` a function whose return-row
-- shape changes — we have to drop first. Safe because the function
-- is security-definer and the only caller is the patient app via
-- usePatientPortalData; redeploying after the migration restores
-- the RPC reference instantly.
drop function if exists get_therapists_for_patient();

create function get_therapists_for_patient()
returns table (
  patient_id uuid,
  therapist_user_id uuid,
  therapist_email text,
  therapist_full_name text,
  therapist_profession text,
  therapist_avatar text,
  therapist_accepts_online_payments boolean
) as $$
  select
    p.id,
    p.user_id,
    au.email::text,
    coalesce(au.raw_user_meta_data->>'full_name', '')::text,
    coalesce(up.profession, 'psychologist')::text,
    coalesce(au.raw_user_meta_data->>'avatar', '')::text,
    coalesce(tca.charges_enabled, false)
  from patients p
  join auth.users au on au.id = p.user_id
  left join user_profiles up on up.user_id = p.user_id
  left join therapist_connect_accounts tca on tca.user_id = p.user_id
  where p.patient_user_id = auth.uid()
    and p.status in ('active', 'potential');
$$ language sql security definer;
