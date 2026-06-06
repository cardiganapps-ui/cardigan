import { useCallback, useEffect, useRef, useState } from "react";

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
   overlay-click would schedule N nested onClose calls.

   Lifecycle safety:
     - The exit setTimeout is tracked in a ref + cleared on unmount,
       so a sheet that unmounts mid-exit (parent force-closed via
       some external state path) doesn't fire onClose against a
       stale parent or setState on a dead component.
     - The same cleanup also fires when `open` flips false
       externally (parent's state change not routed through
       animatedClose). Without it, the timer's stale onClose call
       could fire seconds later. */

const EXIT_MS = 260;

export function useSheetExit(open, onClose) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef(null);

  const cancelTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Unmount cleanup. The component vanishing while a timer is in
  // flight (sheet ripped out by an unrelated parent state change)
  // would otherwise call onClose against a now-stale parent.
  useEffect(() => cancelTimer, [cancelTimer]);

  // External-close cleanup. If the parent decides to close the sheet
  // without routing through animatedClose (rare but possible — admin
  // takeover, network event invalidating the displayed entity), the
  // open prop drops to false. Cancel any in-flight exit timer and
  // reset exiting so the next open doesn't render stuck-mid-exit.
  // The setExiting(false) is intentional and non-cascading: the only
  // dep that could re-fire this effect is `open`, which doesn't
  // depend on `exiting` — and the call is gated behind `!open`, so
  // it only fires once per close transition.
  useEffect(() => {
    if (!open) {
      cancelTimer();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExiting(false);
    }
  }, [open, cancelTimer]);

  const animatedClose = useCallback((...args) => {
    if (!onClose) return;
    if (exiting) return;
    setExiting(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // Forward args so call sites that pass a success message
      // (e.g. PaymentModal: onClose(`Pago registrado: ...`)) still
      // work after the swap to animatedClose.
      onClose(...args);
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
