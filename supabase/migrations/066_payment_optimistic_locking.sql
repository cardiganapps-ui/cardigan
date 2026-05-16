-- 066 — optimistic locking on payments
--
-- Follows the same pattern as migration 065 (sessions). Reuses the
-- generic bump_version_on_update() trigger function defined there, so
-- this migration only needs to add the column and wire the trigger.
--
-- Threat model: a therapist edits a payment on phone (read v=1, ready
-- to save), then on a second device they correct the same row first
-- (server v=2). The phone save with stale v=1 would silently clobber
-- the correction. Single-author single-entry is the common case, but
-- payment data is money — the Prime Directive forbids silent
-- overwrites of money rows even when the conflict is rare.
--
-- updatePayment in usePayments.js is the only payment-mutation path
-- that needs the version filter — createPayment is a new row, and
-- deletePayment by id is idempotent against the user's intent. The
-- patients-counter UPDATE that follows the payment write does not
-- need version locking (denormalized counter; conflicts there are
-- commutative deltas reconciled by recalcPatientCounters).

alter table payments add column if not exists version integer not null default 1;

drop trigger if exists payments_bump_version on payments;
create trigger payments_bump_version
  before update on payments
  for each row execute function public.bump_version_on_update();
