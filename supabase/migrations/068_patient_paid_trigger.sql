-- 068 — patient.paid maintained by trigger
--
-- Today every code path that writes to payments also UPDATEs
-- patient.paid: createPayment (usePayments), deletePayment, updatePayment,
-- and api/stripe-webhook.js for self-pay via Stripe Portal. That's four
-- separate chances to drift if a future code path forgets the patient
-- UPDATE (or computes the wrong delta).
--
-- This trigger makes patient.paid = SUM(payments.amount) an invariant
-- the database itself maintains atomically with every payment write.
-- After this migration, the JS-side .update({ paid: ... }) calls become
-- redundant and are removed in the accompanying code commit.
--
-- recalcPatientCounters (utils/patients.js) stays as a manual recovery
-- tool but is no longer plumbed into the hot path — the trigger is the
-- primary maintainer.
--
-- SECURITY INVOKER: the trigger runs as the user whose write fired it.
-- That user owns the patient row (RLS auth.uid()=user_id), so the
-- recalc UPDATE succeeds. The Stripe webhook uses the service-role key
-- which bypasses RLS entirely — INVOKER inherits that bypass.

create or replace function public.recalc_patient_paid(p_patient_id uuid)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  update patients
  set paid = coalesce(
    (select sum(amount) from payments where patient_id = p_patient_id),
    0
  )
  where id = p_patient_id;
$$;

create or replace function public.trg_payments_recalc_paid()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT') then
    if new.patient_id is not null then
      perform public.recalc_patient_paid(new.patient_id);
    end if;
  elsif (tg_op = 'UPDATE') then
    -- patient_id can change (reassign a payment); recalc both sides
    -- when it does. When only amount changes, recalc the one patient.
    if old.patient_id is distinct from new.patient_id then
      if old.patient_id is not null then perform public.recalc_patient_paid(old.patient_id); end if;
      if new.patient_id is not null then perform public.recalc_patient_paid(new.patient_id); end if;
    elsif old.amount is distinct from new.amount then
      if new.patient_id is not null then perform public.recalc_patient_paid(new.patient_id); end if;
    end if;
  elsif (tg_op = 'DELETE') then
    if old.patient_id is not null then perform public.recalc_patient_paid(old.patient_id); end if;
  end if;
  return null;
end;
$$;

drop trigger if exists payments_recalc_paid_after_iud on payments;
create trigger payments_recalc_paid_after_iud
after insert or update or delete on payments
for each row execute function public.trg_payments_recalc_paid();
