-- Per-patient scheduling mode: 'recurring' (today's perpetual weekly
-- slot, the only model Cardigan supported until now) or 'episodic'
-- (no perpetual slot — the practitioner schedules the next visit at
-- the end of each consult, which is how nutritionists actually work).
--
-- Profession sets the default in the UI (nutrition → episodic, the
-- other four → recurring), but the column is per-patient so a
-- nutritionist with a stable Monday-9 client can still mark them
-- recurring, and a psychologist with a one-off consultation client
-- can mark them episodic. Maximum flexibility, no profession lock-ins.
--
-- Existing rows backfill to 'recurring' via the column default — the
-- only model they could ever have been. The accounting formula is
-- untouched: consumed/amountDue/counters all derive from session rows
-- regardless of how those rows came to exist.
--
-- patients.day + patients.time stay nullable-with-default per the
-- existing schema (they have defaults of 'Lunes' and '16:00' but no
-- NOT NULL constraint), so episodic INSERTs can set them to NULL
-- and signal "no perpetual slot" cleanly.

alter table patients
  add column if not exists scheduling_mode text not null default 'recurring'
    check (scheduling_mode in ('recurring','episodic'));
