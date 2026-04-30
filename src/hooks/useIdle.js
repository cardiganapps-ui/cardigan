import { useEffect, useRef, useState } from "react";

/* ── useIdle ──────────────────────────────────────────────────────────
   Returns a boolean that flips true after `thresholdMs` milliseconds
   without any user activity (mousemove, keydown, touchstart, scroll,
   wheel, pointerdown). Resets back to false on any of those events.

   Used by UpdatePrompt to decide whether it's safe to silently apply
   a pending service-worker update — interrupting an actively-typing
   user with a forced reload reads as a UX failure, while a user who
   walked away from the tab won't notice (or will notice and
   appreciate) the reload.

   Notes:
     - We listen with `passive: true` so we don't fight scroll
       performance.
     - `visibilitychange` gates: when the tab is hidden we treat the
       user as idle regardless of timer (they can't be active in a
       hidden tab). When it goes visible we restart the timer so the
       very-first visible second isn't classified as idle.
     - The hook starts NOT-idle until thresholdMs has elapsed without
       activity. */
export function useIdle(thresholdMs = 30_000) {
  const [isIdle, setIsIdle] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const arm = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setIsIdle(true), thresholdMs);
    };

    const onActivity = () => {
      // Snap out of idle the moment any input arrives so callers can
      // suppress mid-action interruptions immediately.
      setIsIdle(false);
      arm();
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        setIsIdle(true);
      } else {
        setIsIdle(false);
        arm();
      }
    };

    const events = ["mousemove", "mousedown", "pointerdown", "keydown", "touchstart", "scroll", "wheel"];
    for (const evt of events) window.addEventListener(evt, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    arm();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const evt of events) window.removeEventListener(evt, onActivity);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [thresholdMs]);

  return isIdle;
}
