import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { DEFAULT_PROFESSION, PROFESSIONS } from "../data/constants";

/* ── useUserProfile ──
   Fetches the (single) user_profiles row for a given userId. Returns:
     - profession:    string | null   (null = no row yet → onboarding required)
     - loading:       boolean         (true until first fetch resolves)
     - error:         string          (only meaningful for unexpected errors)
     - createProfile: (profession) => Promise<boolean>
                                       (called by ProfessionOnboarding)

   Pass `null` for userId in demo mode / when the caller doesn't have a
   user — the hook short-circuits to { profession: null, loading: false }
   so the consumer can fall back to DEFAULT_PROFESSION cleanly. */
export function useUserProfile(userId) {
  const [profession, setProfession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) {
      // Synchronous setState here is intentional — when the caller
      // toggles to demo / signs out, the next render must reflect
      // "no profile" so the onboarding gate doesn't flash the wrong
      // screen. Same pattern as useCardiganData's loading reset.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfession(null);
      setLoading(false);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      // .maybeSingle() returns data:null without error when zero rows
      // match, which is exactly the "new user, no row yet" case we want
      // to handle as profession=null rather than an error.
      const { data, error: err } = await supabase
        .from("user_profiles")
        .select("profession")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (err) {
        setError(err.message || "Error al cargar profesión");
        setProfession(null);
      } else {
        setProfession(data?.profession ?? null);
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

  /* Optimistic setter for the locally-cached profession. Called by
     AdminPanel after the admin changes their OWN profession via
     /api/admin-update-profession — without this, the admin's open
     Cardigan session keeps rendering the old vocab + theme until they
     manually refresh, because useUserProfile only re-fetches when
     userId changes. The server-side row is already updated by the
     time this runs; we're just hydrating the React state to match. */
  const setProfessionLocal = useCallback((prof) => {
    if (!PROFESSIONS.includes(prof)) return;
    setProfession(prof);
    setError("");
  }, []);

  return { profession, loading, error, createProfile, setProfessionLocal, defaultProfession: DEFAULT_PROFESSION };
}
