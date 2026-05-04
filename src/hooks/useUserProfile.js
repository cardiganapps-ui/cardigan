import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { DEFAULT_PROFESSION, PROFESSIONS, SIGNUP_SOURCES, SIGNUP_SOURCE } from "../data/constants";

/* ── useUserProfile ──
   Fetches the (single) user_profiles row for a given userId. Returns:
     - profession:                string | null
     - signupSource:              string | null
     - signupSourceRecordedAt:    string | null  (ISO timestamp)
     - loading:                   boolean
     - error:                     string
     - createProfile:             (profession) => Promise<boolean>
     - setSignupSource:           ({ signupSource, signupSourceDetail }) => Promise<boolean>
     - setProfessionLocal:        (profession) => void   (admin self-edit hydration)

   Pass `null` for userId in demo mode / when the caller doesn't have a
   user — the hook short-circuits cleanly. */
export function useUserProfile(userId) {
  const [profession, setProfession] = useState(null);
  const [signupSource, setSignupSourceState] = useState(null);
  const [signupSourceRecordedAt, setSignupSourceRecordedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfession(null);
      setSignupSourceState(null);
      setSignupSourceRecordedAt(null);
      setLoading(false);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      const { data, error: err } = await supabase
        .from("user_profiles")
        .select("profession, signup_source, signup_source_recorded_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (err) {
        setError(err.message || "Error al cargar perfil");
        setProfession(null);
        setSignupSourceState(null);
        setSignupSourceRecordedAt(null);
      } else {
        setProfession(data?.profession ?? null);
        setSignupSourceState(data?.signup_source ?? null);
        setSignupSourceRecordedAt(data?.signup_source_recorded_at ?? null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const createProfile = useCallback(async (prof) => {
    if (!userId) return false;
    if (!PROFESSIONS.includes(prof)) {
      setError("Profesión inválida");
      return false;
    }
    const { error: err } = await supabase
      .from("user_profiles")
      .insert({ user_id: userId, profession: prof });
    if (err) {
      setError(err.message || "Error al guardar profesión");
      return false;
    }
    setProfession(prof);
    setError("");
    return true;
  }, [userId]);

  /* Persist the signup acquisition source. Called by SignupSourceStep
     after the user picks one of the predefined channels (or "Otro"
     with free-form detail). Updates the existing user_profiles row
     created by createProfile; never inserts. */
  const setSignupSource = useCallback(async ({ signupSource: source, signupSourceDetail }) => {
    if (!userId) return false;
    if (!SIGNUP_SOURCES.includes(source)) {
      setError("Origen inválido");
      return false;
    }
    if (source === SIGNUP_SOURCE.OTHER) {
      const trimmed = (signupSourceDetail || "").trim();
      if (!trimmed) {
        setError("Detalle requerido para 'Otro'");
        return false;
      }
    }
    const recordedAt = new Date().toISOString();
    const { error: err } = await supabase
      .from("user_profiles")
      .update({
        signup_source: source,
        signup_source_detail: source === SIGNUP_SOURCE.OTHER ? signupSourceDetail.trim() : null,
        signup_source_recorded_at: recordedAt,
      })
      .eq("user_id", userId);
    if (err) {
      setError(err.message || "Error al guardar origen");
      return false;
    }
    setSignupSourceState(source);
    setSignupSourceRecordedAt(recordedAt);
    setError("");
    return true;
  }, [userId]);

  /* Optimistic setter for the locally-cached profession. Called by
     AdminPanel after the admin changes their OWN profession via
     /api/admin-update-profession — without this, the admin's open
     Cardigan session keeps rendering the old vocab + theme until they
     manually refresh. The server-side row is already updated by the
     time this runs; we're just hydrating the React state to match. */
  const setProfessionLocal = useCallback((prof) => {
    if (!PROFESSIONS.includes(prof)) return;
    setProfession(prof);
    setError("");
  }, []);

  return {
    profession,
    signupSource,
    signupSourceRecordedAt,
    loading,
    error,
    createProfile,
    setSignupSource,
    setProfessionLocal,
    defaultProfession: DEFAULT_PROFESSION,
  };
}
