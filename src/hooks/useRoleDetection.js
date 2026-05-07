import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

/* ── useRoleDetection ─────────────────────────────────────────────
   After auth resolves, decide which shell to render:

     therapist — has a user_profiles row with profession set
     patient   — no profession, but is the patient_user_id on at
                 least one patients row (RPC: get_therapists_for_patient)
     orphan    — signed in but neither — rare; usually a stale auth
                 session against a deleted account or a freshly-signed-
                 up user before profession-onboarding completes
     loading   — initial state while the parallel queries resolve

   Two parallel reads keep the cold-start fast: ~1 round-trip vs.
   the 2 we'd pay if we checked therapist first then patient
   sequentially. The role doesn't flip during a session, so we cache
   for the lifetime of the user — `version` bumps force a re-detect
   (used after a successful patient-invite claim). */

export function useRoleDetection(user, version = 0) {
  const [state, setState] = useState({ role: "loading", therapists: [], profession: null });

  // Reset to "loading" when the user changes OR the version bumps
  // via the adjust-during-render pattern (setState-in-effect would
  // trip the lint rule and is unnecessary here — there's no
  // external system to sync with, we're just deriving local state
  // from the user prop).
  //
  // Version-bump reset matters: a successful patient-invite claim
  // bumps version to force a re-detect. WITHOUT resetting to
  // loading, the hook briefly retains the previous role (typically
  // "orphan", because the claim happened against an unlinked user)
  // — and App.jsx would render AppShell for one frame, flashing
  // therapist chrome before the patient shell takes over.
  const [prevUserId, setPrevUserId] = useState(user?.id || null);
  const [prevVersion, setPrevVersion] = useState(version);
  if ((user?.id || null) !== prevUserId) {
    setPrevUserId(user?.id || null);
    setState({ role: "loading", therapists: [], profession: null });
  } else if (version !== prevVersion) {
    setPrevVersion(version);
    setState({ role: "loading", therapists: [], profession: null });
  }

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [profileRes, therapistsRes] = await Promise.all([
          supabase
            .from("user_profiles")
            .select("profession")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase.rpc("get_therapists_for_patient"),
        ]);
        if (cancelled) return;
        const profession = profileRes.data?.profession || null;
        const therapists = therapistsRes.data || [];
        if (profession) {
          // A user_profiles row with a profession means therapist.
          // Even if that user also has linked patient rows (e.g.,
          // they're testing the patient flow against their own
          // therapist account), therapist wins — that's their
          // primary role.
          setState({ role: "therapist", therapists: [], profession });
        } else if (therapists.length > 0) {
          setState({ role: "patient", therapists, profession: null });
        } else {
          setState({ role: "orphan", therapists: [], profession: null });
        }
      } catch {
        if (cancelled) return;
        // Fall back to orphan on errors so we don't infinitely
        // spinner. The orphan screen surfaces a friendly message
        // and a sign-out option.
        setState({ role: "orphan", therapists: [], profession: null });
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, version]);

  return state;
}
