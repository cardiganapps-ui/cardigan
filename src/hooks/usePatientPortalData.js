import { useEffect, useState, useMemo } from "react";
import { supabase } from "../supabaseClient";
import { enrichPatientsWithBalance } from "../utils/accounting";
// Re-exported below for backwards compatibility — components that
// imported `classifySessions` from this file keep working without
// changing their import path.
export { classifySessions } from "../utils/patientPortal";

/* ── usePatientPortalData ─────────────────────────────────────────
   Patient-side data fetcher. Pulls everything needed for the
   read-only portal in a single coordinated load:

     - patient row(s) the user owns (one per linked therapist)
     - sessions across those patient rows
     - therapists' display info (name + profession + email + avatar)
       via the get_therapists_for_patient() security-definer RPC

   v1 returns a single therapist (the first row). The shape is an
   array internally so future multi-therapist UI just iterates.

   The hook deliberately avoids the Big Cardigan data layer
   (useCardiganData) — that one has therapist-side concerns baked
   in (auto-extend, color rotation, write actions, etc.) that don't
   apply on the patient side. A small dedicated hook keeps the
   patient surface tight and the read path obvious.

   Loading shape mirrors useCardiganData's: { loading, error,
   patients, sessions, therapists, refresh } so the patient shell's
   render code reads similarly to the therapist app where useful. */

export function usePatientPortalData(user) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [patients, setPatients] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [therapists, setTherapists] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = () => setReloadKey(k => k + 1);

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Three queries in parallel. Each is gated by RLS — the
        // patient sees only their own rows.
        const [pRes, sRes, tRes] = await Promise.all([
          supabase
            .from("patients")
            .select("id, name, rate, billed, paid, sessions, scheduling_mode, day, time, status, user_id, parent, birthdate, allergies, medical_conditions, height_cm, goal_weight_kg, patient_intake_completed_at")
            .eq("patient_user_id", user.id),
          supabase
            .from("sessions")
            .select("id, patient_id, date, time, duration, modality, status, rate, session_type, is_recurring, cancel_reason")
            .order("date", { ascending: false })
            .limit(500),
          supabase.rpc("get_therapists_for_patient"),
        ]);
        if (cancelled) return;
        if (pRes.error) throw pRes.error;
        if (sRes.error) throw sRes.error;
        if (tRes.error) throw tRes.error;
        // Sessions are returned UN-ordered by date string ("D-MMM"
        // doesn't sort lexicographically). The home view re-sorts
        // them via shortDateToISO downstream. We just trust RLS
        // gave us only sessions for our patient rows.
        setPatients(pRes.data || []);
        setSessions(sRes.data || []);
        setTherapists(tRes.data || []);
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || "No pudimos cargar tus datos.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, reloadKey]);

  // Run the standard accounting derivation. Same helper the
  // therapist app uses, so the patient sees the EXACT amount the
  // therapist sees — single source of truth. The prime directive
  // is enforced by reusing the predicate, not by re-implementing.
  const enrichedPatients = useMemo(
    () => enrichPatientsWithBalance(patients, sessions),
    [patients, sessions]
  );

  // Cross-row totals: amountDue across all linked patient rows
  // (typically 1 in v1; future multi-therapist could be N).
  const totalAmountDue = useMemo(
    () => enrichedPatients.reduce((sum, p) => sum + (p.amountDue || 0), 0),
    [enrichedPatients]
  );
  const totalCredit = useMemo(
    () => enrichedPatients.reduce((sum, p) => sum + (p.credit || 0), 0),
    [enrichedPatients]
  );

  // The "primary" linked therapist for v1 UI. First row by
  // ordering — Supabase returns the patient row(s) in their
  // natural creation order; the matching therapist is the first
  // entry in `therapists`. Future multi-therapist UI iterates
  // therapists[] and uses patient_id to scope each section.
  const primaryTherapist = therapists[0] || null;
  const primaryPatient = enrichedPatients[0] || null;

  return {
    loading,
    error,
    patients: enrichedPatients,
    sessions,
    therapists,
    primaryTherapist,
    primaryPatient,
    totalAmountDue,
    totalCredit,
    refresh,
  };
}

