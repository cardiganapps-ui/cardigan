-- 083 — transactional patient creation (WS-3)
--
-- Threat model: createPatient (src/hooks/usePatients.ts) inserted the
-- patient row, then in a SEPARATE round-trip inserted N recurring session
-- rows, then best-effort reconciled counters via recalcPatientCounters.
-- A failure between the two inserts (network drop, RLS hiccup, crash)
-- left an ORPHAN patient with no sessions and stale counters. The
-- uniq_sessions_patient_date_time index prevents *duplicates*, not
-- *partial writes* — so this is a real integrity gap on the create path.
--
-- Fix: one RPC that inserts the patient + all sessions inside a single
-- transaction. Either the whole thing commits or nothing does — no
-- orphans. Per-session 23505 (duplicate slot) is swallowed at a
-- savepoint so a re-submit is idempotent (Prime Directive #1) without
-- aborting the surrounding patient insert.
--
-- Mirrors the security posture of update_session_status_atomic (065):
--   • security invoker  — runs as the calling user, so RLS WITH CHECK
--     (auth.uid() = user_id) applies to every insert.
--   • user_id is forced from auth.uid(), never read from the client
--     payload, so a caller can't plant rows under another user.
--   • the unauthenticated branch raises 42501 like the session RPC.
--
-- The counter trigger (trg_sessions_recalc_counters, migration 069)
-- fires on each session insert, so after the loop the patient row's
-- billed/sessions are already authoritative; we re-select to return
-- those rather than the client's optimistic seed.

create or replace function public.create_patient_with_sessions(
  p_patient jsonb,
  p_sessions jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_patient patients%rowtype;
  v_session sessions%rowtype;
  v_sessions jsonb := '[]'::jsonb;
  s jsonb;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  insert into patients (
    user_id, name, parent, phone, email, initials, rate, day, time,
    color_idx, start_date, scheduling_mode, birthdate, tutor_frequency,
    height_cm, goal_weight_kg, goal_body_fat_pct, goal_skeletal_muscle_kg,
    allergies, medical_conditions, sessions, billed, opening_balance,
    whatsapp_enabled, whatsapp_consent_at, external_folder_url
  ) values (
    v_user_id,
    p_patient->>'name',
    coalesce(p_patient->>'parent', ''),
    coalesce(p_patient->>'phone', ''),
    coalesce(p_patient->>'email', ''),
    p_patient->>'initials',
    coalesce((p_patient->>'rate')::int, 0),
    p_patient->>'day',
    p_patient->>'time',
    coalesce((p_patient->>'color_idx')::int, 0),
    (p_patient->>'start_date')::date,
    coalesce(p_patient->>'scheduling_mode', 'recurring'),
    (p_patient->>'birthdate')::date,
    (p_patient->>'tutor_frequency')::int,
    (p_patient->>'height_cm')::int,
    (p_patient->>'goal_weight_kg')::numeric,
    (p_patient->>'goal_body_fat_pct')::numeric,
    (p_patient->>'goal_skeletal_muscle_kg')::numeric,
    coalesce(p_patient->>'allergies', ''),
    coalesce(p_patient->>'medical_conditions', ''),
    coalesce((p_patient->>'sessions')::int, 0),
    coalesce((p_patient->>'billed')::int, 0),
    coalesce((p_patient->>'opening_balance')::int, 0),
    coalesce((p_patient->>'whatsapp_enabled')::boolean, false),
    (p_patient->>'whatsapp_consent_at')::timestamptz,
    p_patient->>'external_folder_url'
  ) returning * into v_patient;

  for s in select * from jsonb_array_elements(coalesce(p_sessions, '[]'::jsonb)) loop
    begin
      insert into sessions (
        user_id, patient_id, patient, initials, time, day, date,
        duration, rate, modality, color_idx, is_recurring,
        recurrence_frequency, visit_type
      ) values (
        v_user_id, v_patient.id,
        s->>'patient', s->>'initials', s->>'time', s->>'day', s->>'date',
        coalesce((s->>'duration')::int, 60),
        (s->>'rate')::int,
        coalesce(s->>'modality', 'presencial'),
        coalesce((s->>'color_idx')::int, 0),
        coalesce((s->>'is_recurring')::boolean, false),
        coalesce(s->>'recurrence_frequency', 'weekly'),
        s->>'visit_type'
      ) returning * into v_session;
      v_sessions := v_sessions || to_jsonb(v_session);
    exception when unique_violation then
      -- 23505 on uniq_sessions_patient_date_time: idempotent skip.
      -- The savepoint this BEGIN/EXCEPTION opens rolls back only the
      -- offending insert, leaving the patient + prior sessions intact.
      null;
    end;
  end loop;

  -- Trigger-authoritative counters now live on the patient row.
  select * into v_patient from patients where id = v_patient.id;

  return jsonb_build_object(
    'patient', to_jsonb(v_patient),
    'sessions', v_sessions
  );
end;
$$;
