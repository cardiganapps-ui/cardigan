-- ── Foreign-key constraints on user_id → auth.users(id) ────────────
--
-- Backstory: on Apr 29 a faulty maintenance script deleted the admin
-- user from auth.users. 99 rows of patient / session / payment data
-- survived the deletion because their tables had NO foreign-key
-- constraint to auth.users. The data was orphaned (visible only by
-- service-role queries) until manually re-linked.
--
-- Adding the missing FKs with ON DELETE CASCADE means a future
-- accidental user deletion takes the data with it (no orphans), and
-- the deletion will be loud — the cascade either succeeds cleanly or
-- fails because the user has data, in which case the operator has to
-- explicitly choose to lose the data. Either outcome is better than
-- the silent orphan we hit today.
--
-- Tables already covered (skipped here):
--   documents, user_consents, export_audit, user_calendar_tokens,
--   user_encryption_keys, whatsapp_audit, user_profiles, bug_reports.
--
-- Tables fixed by this migration:
--   patients, sessions, payments, notes, measurements,
--   push_subscriptions, sent_reminders, notification_preferences.

-- Belt-and-suspenders: the audit script must show zero orphans first
-- (see scripts/audit-orphan-rows.mjs). If any remain, ALTER TABLE
-- below will fail with "violates foreign key constraint" and roll
-- back, which is the right outcome.

ALTER TABLE public.patients
  ADD CONSTRAINT patients_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id)
  ON DELETE CASCADE;

ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id)
  ON DELETE CASCADE;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id)
  ON DELETE CASCADE;

ALTER TABLE public.notes
  ADD CONSTRAINT notes_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id)
  ON DELETE CASCADE;

ALTER TABLE public.measurements
  ADD CONSTRAINT measurements_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id)
  ON DELETE CASCADE;

ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id)
  ON DELETE CASCADE;

ALTER TABLE public.sent_reminders
  ADD CONSTRAINT sent_reminders_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id)
  ON DELETE CASCADE;

ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id)
  ON DELETE CASCADE;
