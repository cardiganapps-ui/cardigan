-- ── 056_user_delete_cascade_fix.sql ──
-- Two FK constraints to auth.users were created without an
-- ON DELETE clause (defaulting to NO ACTION), which blocks the
-- admin "Eliminar cuenta" flow with "Database error deleting
-- user" once the account has either of these rows:
--
--   patient_invites.used_by_user_id          (claimer of an invite)
--   patient_payment_intents.paid_by_user_id  (patient who paid)
--
-- Different fixes per column, picked to match each column's
-- nullability + the audit-value of the row after the user is gone:
--
-- 1. patient_invites.used_by_user_id is already nullable. The row
--    is mostly an audit trail (was the invite used + when); the
--    "by whom" is nice to have but optional. SET NULL preserves
--    the row with a null pointer — the therapist's UI never reads
--    used_by_user_id directly, so nothing breaks.
--
-- 2. patient_payment_intents.paid_by_user_id is NOT NULL (a payment
--    intent must have a payer). SET NULL would violate the NOT NULL
--    constraint, and dropping NOT NULL is wrong — a payment intent
--    without a payer is meaningless. CASCADE is correct here: once
--    the paying user is deleted, the per-attempt PI row is no
--    longer useful (the therapist's source of truth for the money
--    that actually moved is the linked payments table row, which
--    survives via its own user_id = therapist's id). The PI row
--    going away is the right outcome.

alter table patient_invites
  drop constraint if exists patient_invites_used_by_user_id_fkey;

alter table patient_invites
  add constraint patient_invites_used_by_user_id_fkey
    foreign key (used_by_user_id) references auth.users(id)
    on delete set null;

alter table patient_payment_intents
  drop constraint if exists patient_payment_intents_paid_by_user_id_fkey;

alter table patient_payment_intents
  add constraint patient_payment_intents_paid_by_user_id_fkey
    foreign key (paid_by_user_id) references auth.users(id)
    on delete cascade;
