-- ── Backfill correction: legacy one-offs ───────────────────────────
--
-- Migration 025 added is_recurring and backfilled every existing row
-- to true, because there was no clean way at the time to retroactively
-- guess intent. That means pre-025 one-offs (sessions added via the
-- "+ session" FAB before the column existed) appear identical to real
-- recurring sessions.
--
-- The resulting visible bug: the Resumen → Horarios row was showing
-- ancient one-off slots as if they were part of the recurring schedule
-- (e.g. Fernando Guerrero's "Sábado · 09:00" appearing alongside his
-- real "Miércoles · 14:45" recurring slot).
--
-- Heuristic: a slot is a legacy one-off if all of these hold:
--   1. The session was created before migration 025 (created_at <
--      2026-04-27 04:00 UTC, the commit time of migration 025).
--   2. The patient HAS post-migration data we can compare against —
--      i.e. they've had auto-extend run or a schedule change happen
--      since. Patients with no post-migration data are left alone (we
--      can't tell intent).
--   3. The (patient, day, time) slot does NOT appear in the patient's
--      post-migration recurring sessions.
--   4. The slot has ≤3 legacy sessions on it. This is the conservative
--      cutoff that catches actual one-offs (typically 1-2 occurrences)
--      without re-tagging legitimate past recurring slots that the
--      patient has since changed away from (those have ≥10 sessions
--      historically). The 4-5 range is ambiguous and intentionally
--      left untouched.
--
-- Affected on production (verified by survey query before applying):
--   - 2 sessions across 2 slots, all in the ≤3 bucket.
--
-- After this migration, is_recurring becomes a trustworthy signal for
-- the entire dataset. The frontend slot-occupancy fallback heuristic
-- (PR #55) becomes belt-and-suspenders defence rather than the load-
-- bearing check.

WITH true_recurring_slots AS (
  -- Slots that are confirmed recurring because a post-migration
  -- session was created on them (auto-extend or schedule change).
  SELECT DISTINCT user_id, patient_id, day, time
    FROM public.sessions
   WHERE created_at >= '2026-04-27 04:00:00+00'
     AND is_recurring = true
),
patients_with_post_migration_data AS (
  -- Only patients we have a post-migration baseline for. Others stay
  -- as-is so we don't mistake a long-departed patient's old schedule
  -- for a one-off.
  SELECT DISTINCT user_id, patient_id
    FROM public.sessions
   WHERE created_at >= '2026-04-27 04:00:00+00'
),
candidate_slots AS (
  -- Legacy slots not present in true_recurring_slots, grouped to
  -- count how many sessions sit on each.
  SELECT s.user_id, s.patient_id, s.day, s.time, COUNT(*) AS n
    FROM public.sessions s
   WHERE s.created_at < '2026-04-27 04:00:00+00'
     AND s.is_recurring = true
     AND EXISTS (SELECT 1 FROM patients_with_post_migration_data p
                  WHERE p.user_id = s.user_id AND p.patient_id = s.patient_id)
     AND NOT EXISTS (SELECT 1 FROM true_recurring_slots t
                      WHERE t.user_id = s.user_id
                        AND t.patient_id = s.patient_id
                        AND t.day = s.day AND t.time = s.time)
   GROUP BY s.user_id, s.patient_id, s.day, s.time
),
slots_to_correct AS (
  SELECT user_id, patient_id, day, time
    FROM candidate_slots
   WHERE n <= 3
)
UPDATE public.sessions s
   SET is_recurring = false
  FROM slots_to_correct c
 WHERE s.user_id = c.user_id
   AND s.patient_id = c.patient_id
   AND s.day = c.day
   AND s.time = c.time
   AND s.is_recurring = true;
