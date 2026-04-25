-- Add 'telefonica' as a third session modality.
-- Existing rows ('presencial' / 'virtual') keep their value; default
-- stays 'presencial'.
alter table sessions drop constraint if exists sessions_modality_check;
alter table sessions add constraint sessions_modality_check
  check (modality in ('presencial', 'virtual', 'telefonica'));
