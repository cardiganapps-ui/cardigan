-- 059_expenses.sql
-- Adds the money-out half of the books: expenses + recurring expense templates.
--
-- Idempotence is enforced at the DB layer via the partial unique index on
-- (recurring_id, period_year, period_month). This mirrors the
-- uniq_sessions_patient_date_time invariant from the prime directive in
-- CLAUDE.md: any code path that inserts a recurring-generated expense must
-- handle the 23505 unique-violation cleanly (skip / no-op, never crash).
-- See useExpenses::generateRecurringExpenses for the on-conflict handling.
--
-- Documents are extended with a `kind` discriminator so receipt files don't
-- pollute the patient ArchivoTab. patient = the existing case (linked to a
-- patient, surfaces in their expediente). receipt = uploaded as part of an
-- expense entry, only ever surfaced through the expense it backs.

create table if not exists recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount > 0),
  category text not null,
  description text,
  day_of_month smallint not null check (day_of_month between 1 and 31),
  payment_method text,
  tax_treatment text not null default 'deductible'
    check (tax_treatment in ('deductible','non_deductible','personal')),
  active boolean not null default true,
  start_year smallint not null,
  start_month smallint not null check (start_month between 1 and 12),
  paused_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount > 0),
  date text not null,
  category text not null check (category in (
    'consultorio','servicios','software','insumos','formacion',
    'honorarios','transporte','marketing','comisiones','impuestos','otro'
  )),
  description text,
  payment_method text check (payment_method in ('Transferencia','Efectivo','Tarjeta','Otro')),
  tax_treatment text not null default 'deductible'
    check (tax_treatment in ('deductible','non_deductible','personal')),
  cfdi_uuid text,
  cfdi_url text,
  recurring_id uuid references recurring_expenses(id) on delete set null,
  period_year smallint,
  period_month smallint check (period_month is null or period_month between 1 and 12),
  receipt_document_id uuid references documents(id) on delete set null,
  note text,
  color_idx integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists uniq_expenses_recurring_period
  on expenses(recurring_id, period_year, period_month)
  where recurring_id is not null;
create index if not exists idx_expenses_user_id on expenses(user_id);
create index if not exists idx_expenses_user_date on expenses(user_id, date);
create index if not exists idx_expenses_category on expenses(user_id, category);
create index if not exists idx_recurring_expenses_user_id on recurring_expenses(user_id);

alter table expenses enable row level security;
alter table recurring_expenses enable row level security;

create policy "Users manage own expenses" on expenses
  for all using (auth.uid() = user_id);
create policy "Admin reads all expenses" on expenses
  for select using (is_admin());

create policy "Users manage own recurring expenses" on recurring_expenses
  for all using (auth.uid() = user_id);
create policy "Admin reads all recurring expenses" on recurring_expenses
  for select using (is_admin());

-- Discriminate documents so the patient archive doesn't leak receipts.
alter table documents add column if not exists kind text not null default 'patient';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'documents_kind_check'
  ) then
    alter table documents add constraint documents_kind_check
      check (kind in ('patient','receipt'));
  end if;
end $$;
create index if not exists idx_documents_user_kind on documents(user_id, kind);
