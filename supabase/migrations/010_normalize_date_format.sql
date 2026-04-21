-- Normalize `date` on write so stale PWA clients (pre-15cad3e, which
-- output "20 Abr" space format) can't reintroduce format drift in the
-- DB. PostgREST clients bypass this trigger's RETURNING with the new
-- value, so reads always see the canonical "D-MMM" form.
--
-- Handles both full-width and any variant of separator (space, hyphen,
-- or multiple). If the input doesn't look like a short date, it's left
-- untouched so downstream parsers/tests still see the original.

CREATE OR REPLACE FUNCTION normalize_short_date(raw TEXT) RETURNS TEXT AS $$
DECLARE
  parts TEXT[];
  d INT;
  m TEXT;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  parts := regexp_split_to_array(btrim(raw), '[\s-]+');
  IF array_length(parts, 1) < 2 THEN RETURN raw; END IF;
  BEGIN
    d := parts[1]::INT;
  EXCEPTION WHEN OTHERS THEN
    RETURN raw;
  END;
  m := parts[2];
  IF m NOT IN ('Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic') THEN
    RETURN raw;
  END IF;
  RETURN d::TEXT || '-' || m;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION sessions_normalize_date() RETURNS TRIGGER AS $$
BEGIN
  NEW.date := normalize_short_date(NEW.date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION payments_normalize_date() RETURNS TRIGGER AS $$
BEGIN
  NEW.date := normalize_short_date(NEW.date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sessions_normalize_date_trg ON sessions;
CREATE TRIGGER sessions_normalize_date_trg
  BEFORE INSERT OR UPDATE OF date ON sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_normalize_date();

DROP TRIGGER IF EXISTS payments_normalize_date_trg ON payments;
CREATE TRIGGER payments_normalize_date_trg
  BEFORE INSERT OR UPDATE OF date ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_normalize_date();
