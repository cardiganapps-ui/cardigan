-- Add session modality (presencial / virtual).
-- Default 'presencial' so existing sessions require no data migration.
alter table sessions add column if not exists modality text default 'presencial'
  check (modality in ('presencial', 'virtual'));
