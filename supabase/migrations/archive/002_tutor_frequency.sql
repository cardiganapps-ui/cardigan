-- Add tutor session frequency preference (in weeks) for minor patients.
-- NULL means no reminder configured; typical values: 4, 6, 8, 12.
alter table patients add column if not exists tutor_frequency integer default null;
