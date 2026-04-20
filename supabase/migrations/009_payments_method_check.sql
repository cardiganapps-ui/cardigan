-- Normalize payments.method values and add a CHECK constraint so only
-- canonical values (matching PAYMENT_METHODS in src/data/constants.js)
-- can be stored.
--
-- Why: the production DB contained one row with method='RETIRO SIN TARJETA'
-- (all caps) while the app produces 'Retiro sin Tarjeta'. Adding the CHECK
-- would have failed on that row, so we normalize first.

-- 1. Normalize any casing/legacy variants to the canonical form.
update payments set method = 'Retiro sin Tarjeta' where method = 'RETIRO SIN TARJETA';

-- 2. Add the CHECK constraint. Matches data/constants.js::PAYMENT_METHODS.
alter table payments drop constraint if exists payments_method_check;
alter table payments add constraint payments_method_check
  check (method in ('Transferencia', 'Efectivo', 'Tarjeta', 'Retiro sin Tarjeta', 'Otro'));
