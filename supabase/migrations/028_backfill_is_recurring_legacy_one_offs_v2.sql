-- ── Backfill correction v2 ─────────────────────────────────────────
--
-- Migration 027's timestamp-based heuristic missed cases where the
-- patient's most recent session was created just before the chosen
-- cutoff (Fernando Guerrero — both his Sábado one-offs created
-- 2026-04-13 + 2026-04-27 03:14, just before the 04:00 boundary).
--
-- This pass uses pure structural signal — no timestamps:
--
--   A patient with a real recurring schedule will have at least one
--   slot with MANY sessions (auto-extend has been running, so
--   ≥RECURRENCE_WINDOW_WEEKS=15 future sessions per recurring slot).
--   Any other slot with ≤3 sessions on that same patient is, by
--   construction, a one-off (or a tiny cluster of one-offs that
--   never repeated weekly).
--
-- Conservative cutoffs:
--   - "Real recurring schedule" = at least one slot with ≥10 active
--     sessions (a comfortable lower bound under the typical 15-week
--     extend window).
--   - "Looks like one-off" = ≤3 sessions on the slot. Slots with 4-5
--     sessions stay untouched — could be a short-lived recurring or
--     a cluster of one-offs; ambiguous, leave alone.
--
-- Patients with no recurring slot anywhere (e.g. only ever scheduled
-- ad-hoc) are not modified — we have no anchor to compare against.

WITH patient_slot_counts AS (
  -- Active sessions per (patient, day, time). Cancelled and charged
  -- rows excluded so a slot that was abandoned via cancellation
  -- doesn't inflate the count.
  SELECT user_id, patient_id, day, time, COUNT(*) AS n
    FROM public.sessions
   WHERE status NOT IN ('cancelled', 'charged')
   GROUP BY user_id, patient_id, day, time
),
patients_with_real_recurring AS (
  SELECT DISTINCT user_id, patient_id
    FROM patient_slot_counts
   WHERE n >= 10
),
one_off_slots AS (
  SELECT psc.user_id, psc.patient_id, psc.day, psc.time
    FROM patient_slot_counts psc
   WHERE psc.n <= 3
     AND EXISTS (SELECT 1 FROM patients_with_real_recurring r
                  WHERE r.user_id = psc.user_id
                    AND r.patient_id = psc.patient_id)
)
UPDATE public.sessions s
   SET is_recurring = false
  FROM one_off_slots o
 WHERE s.user_id = o.user_id
   AND s.patient_id = o.patient_id
   AND s.day = o.day
   AND s.time = o.time
   AND s.is_recurring = true;
