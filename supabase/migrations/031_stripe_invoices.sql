-- Per-user invoice ledger so the Settings → plan panel can render a
-- billing history without bouncing through the Stripe Billing Portal.
-- Populated by api/stripe-webhook.js on every `invoice.paid` event.
--
-- Source of truth is still Stripe; this table is a denormalized read
-- model. Backfill is intentionally NOT required — the table accrues
-- forward and the Stripe Billing Portal remains available for the full
-- pre-table history.

create table if not exists stripe_invoices (
  -- Stripe's `in_*` invoice id. Primary key so a re-delivered
  -- invoice.paid webhook upserts cleanly without duplicating rows.
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text,
  -- MXN cents matching Stripe's amount semantics.
  amount_cents integer not null,
  currency text not null default 'mxn',
  paid_at timestamptz not null,
  -- For "Ver recibo" links in the UI.
  hosted_invoice_url text,
  pdf_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_stripe_invoices_user_paid_at
  on stripe_invoices(user_id, paid_at desc);

alter table stripe_invoices enable row level security;

-- Owner reads own invoice history. Admin sees all (for support).
create policy "Users read own invoices"
  on stripe_invoices for select
  using (auth.uid() = user_id);

create policy "Admin reads all invoices"
  on stripe_invoices for select
  using (is_admin());

-- No INSERT / UPDATE / DELETE policies for the user role: writes are
-- exclusively through the service-role client in api/stripe-webhook.js.
