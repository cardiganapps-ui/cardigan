-- Add 'a-domicilio' as a fourth session modality (Phase 3, tutor support).
-- Tutors and music teachers travel to the student's home — that's the
-- defining "a domicilio" modality. Existing rows keep their value;
-- default stays 'presencial' so nothing changes for psych/nutri users.
--
-- Mirrors the approach of migration 020_session_modality_telefonica.sql:
-- drop the old check constraint, add the widened one.
alter table sessions drop constraint if exists sessions_modality_check;
alter table sessions add constraint sessions_modality_check
  check (modality in ('presencial', 'virtual', 'telefonica', 'a-domicilio'));
