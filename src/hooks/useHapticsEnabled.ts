import { useState, useCallback } from "react";
import { isHapticsEnabled, setHapticsEnabled as setFlag, haptic } from "../utils/haptics";

/* ── useHapticsEnabled ────────────────────────────────────────────────
   React mirror of the per-device vibration preference that lives in
   utils/haptics.ts (Settings → Funciones → Vibración). Added after Play
   Store testers flagged unwanted vibration. Per-device (not per-user)
   because haptics also fire pre-login — same scope as theme/accent.

   The setter write-throughs into the module flag + localStorage, and
   fires a confirming tap when turning ON so the user feels the setting
   take effect (nothing when disabling — that's the point). */

export function useHapticsEnabled() {
  const [hapticsEnabled, setState] = useState(isHapticsEnabled);
  const setHapticsEnabled = useCallback((val: boolean) => {
    setState(val);
    setFlag(val);
    if (val) haptic.tap();
  }, []);
  return { hapticsEnabled, setHapticsEnabled };
}
