import { useCallback, useState } from "react";

/* ── useSheetExit ──
   Animated close for bottom sheets. Returns an `animatedClose`
   callable that plays the CSS exit animation (.sheet-overlay--exit
   on the scrim, .sheet-panel--exit on the panel — see screens.css)
   and then fires `onClose` after EXIT_MS so the parent's "remove
   sheet from tree" happens in sync with the animation end, not
   instantly.

   Pattern (typical sheet):
     const { exiting, animatedClose } = useSheetExit(open, onClose);
     useEscape(animatedClose);
     // useSheetDrag stays on raw onClose — it owns its own drag-
     // dismiss animation and would double-animate if it ran through
     // animatedClose.
     return (
       <div className={`sheet-overlay ${exiting ? "sheet-overlay--exit" : ""}`}
            onClick={animatedClose}>
         <div className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`}>
           ...
           <button onClick={animatedClose}>×</button>
         </div>
       </div>
     );

   Why this works against the `{open && <Sheet />}` pattern most
   call sites use: the parent only removes the sheet when onClose
   is invoked. Delaying onClose by EXIT_MS keeps the sheet mounted
   for the duration of its own exit, then the parent unmounts it.
   No call-site refactor needed.

   Reduced motion: the EXIT_MS countdown still runs (so the parent's
   close still fires deterministically), but the CSS animation is
   suppressed app-wide by responsive.css's prefers-reduced-motion
   rule. Effectively: the sheet just disappears instantly under
   reduced motion, which is the intended honoring of the system
   setting.

   Re-entrant guard: once exiting=true, subsequent animatedClose()
   calls are no-ops. Without it, a user mashing Escape after an
   overlay-click would schedule N nested onClose calls. */

const EXIT_MS = 260;

export function useSheetExit(open, onClose) {
  const [exiting, setExiting] = useState(false);

  const animatedClose = useCallback(() => {
    if (!onClose) return;
    if (exiting) return;
    setExiting(true);
    setTimeout(() => {
      onClose();
      // Reset for any case where the parent keeps the sheet rendered
      // (rare) — without resetting we'd be stuck in exiting=true on
      // next open. The parent's natural unmount will throw the state
      // away anyway; this just covers the long-tail.
      setExiting(false);
    }, EXIT_MS);
  }, [onClose, exiting]);

  return { exiting, animatedClose };
}

export const SHEET_EXIT_MS = EXIT_MS;
