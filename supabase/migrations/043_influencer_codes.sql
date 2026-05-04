-- Migration 043: influencer / partner discount codes.
--
-- Admin creates a code for an influencer (e.g. "MARIANA20"). New
-- visitors who arrive via cardigan.mx/c/<code> have the code stashed
-- in sessionStorage; when they hit /api/stripe-checkout the code's
-- linked Stripe Promotion Code is applied to the Checkout Session,
-- so the discount auto-applies without the user having to type
-- anything. Manual entry at the Stripe Checkout promo-code field
-- still works as a fallback because the Promotion Code is also
-- registered in Stripe.
--
-- We track which user used which code in user_subscriptions so the
-- admin "Códigos" tab can show per-code conversion stats.

create table if not exists influencer_codes (
  id uuid primary key default gen_random_uuid(),
  -- Friendly customer-facing code (e.g. "MARIANA20"). Uppercase
  -- A-Z 0-9 only, 4-20 chars. Unique per Cardigan; Stripe also
  -- enforces uniqueness within our account so a duplicate insert
  -- here will mirror a Stripe API error.
  code text not null unique check (
    code ~ '^[A-Z0-9]{4,20}$'
  ),
  -- Stripe Coupon + Promotion Code IDs. Coupon defines the discount,
  -- Promotion Code is the customer-facing redemption token mapping
  -- back to it. We need both to disable / archive the code later.
  stripe_coupon_id text not null,
  stripe_promotion_code_id text not null,
  -- Display-only. Helps admin remember whose code is whose.
  influencer_name text,
  -- v1: percent-off only. amount-off can be added later via a new
  -- `discount_type` column + check constraint without breaking
  -- existing rows.
  percent_off integer not null check (percent_off >= 1 and percent_off <= 100),
  -- Stripe Coupon duration semantics:
  --   'once'      → applied to first invoice only
  --   'repeating' → applied to next N invoices (months)
  --   'forever'   → applied to every invoice
  duration text not null check (duration in ('once', 'repeating', 'forever')),
  duration_in_months integer check (
    (duration <> 'repeating' and duration_in_months is null)
    or (duration = 'repeating' and duration_in_months between 1 and 12)
  ),
  -- Soft-disable. Setting active=false ALSO archives the underlying
  -- Stripe Promotion Code (so manual entry stops working) but the
  -- row stays here for historical attribution lookups.
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  notes text
);

alter table user_subscriptions
  add column if not exists influencer_code_id uuid references influencer_codes(id) on delete set null;

create index if not exists idx_user_subscriptions_influencer_code
  on user_subscriptions(influencer_code_id);

-- RLS: influencer_codes is admin-only. Users never see them; the
-- short-link visitor flow never reads from this table directly —
-- the server-side stripe-checkout endpoint does the lookup using
-- the service-role client.
alter table influencer_codes enable row level security;

drop policy if exists "admin reads influencer codes" on influencer_codes;
create policy "admin reads influencer codes"
  on influencer_codes for select
  using (is_admin());

drop policy if exists "admin writes influencer codes" on influencer_codes;
create policy "admin writes influencer codes"
  on influencer_codes for all
  using (is_admin())
  with check (is_admin());
