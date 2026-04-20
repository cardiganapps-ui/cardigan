-- Normalize session and payment `date` strings from the legacy "D MMM"
-- form to the canonical "D-MMM" form. The app's read path also normalizes
-- (see src/hooks/useCardiganData.js::mapRows), so this migration is not
-- required for correctness — it keeps the database clean and lets future
-- queries match on a single format without an IN (...) workaround.
update sessions set date = replace(date, ' ', '-') where date like '% %';
update payments set date = replace(date, ' ', '-') where date like '% %';
