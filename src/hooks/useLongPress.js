import { useCallback, useEffect, useRef } from "react";
import { haptic } from "../utils/haptics";

/* ── useLongPress ──
   iOS-style long-press detector. Returns touch handler props to spread
   onto any element. After LONG_PRESS_MS ms of a stationary touch, the
   callback fires with the original touch coordinates and a haptic
   "warn" buzz signals the trigger.

   Cancels cleanly on:
     - touchmove > MOVE_TOLERANCE px (the user is scrolling, not
       holding) — avoids accidental trigger during vertical scroll.
     - touchend before the timer elapses (it was just a tap).
     - touchcancel (multi-touch, system gesture).
     - unmount mid-press.

   The contextmenu event handler is forwarded straight through, so
   desktop right-click continues to work without a parallel code path.

   Usage:
     const longPress = useLongPress((x, y) => openCtxMenu({ clientX: x, clientY: y }));
     return <div {...longPress.bind} onContextMenu={(e) => openCtxMenu(e)}>...</div>;

   The hook intentionally does NOT preventDefault on touchstart. iOS
   already shows a system-level long-press affordance (text selection,
   image save) on certain elements; suppressing it globally would
   feel wrong. Callers can preventDefault inside their callback if
   they need to.

   Click suppression after a fired long-press:
     We track the fire TIMESTAMP, not a boolean flag. Earlier this
     hook used `firedRef.current = true` and only reset it inside
     onClickCapture or the next touchstart. That left the flag stuck
     when preventDefault on touchend successfully suppressed the
     synthetic click — keyboard activations (Enter/Space) within the
     same wrapper would then hit onClickCapture and get swallowed
     too. The timestamp scheme swallows clicks only within
     CLICK_SUPPRESS_MS of the fire; after that window, any click
     (keyboard or otherwise) passes through normally. */

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE = 10;
// Window after a fired long-press during which a synthetic click is
// suppressed. iOS fires the synthetic click within ~50ms of touchend;
// 300ms is comfortably past that. Keyboard activations (Enter/Space)
// outside this window pass through normally.
const CLICK_SUPPRESS_MS = 300;

export function useLongPress(onLongPress, { enabled = true, ms = LONG_PRESS_MS } = {}) {
  const timerRef = useRef(null);
  const startRef = useRef(null);
  const firedAtRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const onTouchStart = useCallback((e) => {
    if (!enabled || !onLongPress) return;
    const t = e.touches[0];
    if (!t) return;
    startRef.current = { x: t.clientX, y: t.clientY };
    firedAtRef.current = 0;
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      firedAtRef.current = Date.now();
      haptic.warn?.();
      onLongPress(startRef.current.x, startRef.current.y);
    }, ms);
  }, [enabled, onLongPress, ms, clearTimer]);

  const onTouchMove = useCallback((e) => {
    if (!startRef.current) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - startRef.current.x;
    const dy = t.clientY - startRef.current.y;
    if (dx * dx + dy * dy > MOVE_TOLERANCE * MOVE_TOLERANCE) {
      // User moved their finger — they're scrolling, not pressing.
      clearTimer();
      startRef.current = null;
    }
  }, [clearTimer]);

  const onTouchEnd = useCallback((e) => {
    clearTimer();
    // If the long-press already fired AND the touchend event is still
    // cancelable, preventDefault suppresses the synthetic click iOS
    // would otherwise dispatch microseconds later. The CLICK_SUPPRESS
    // window below handles the case where preventDefault was a no-op
    // (e.g. cancelable was already false because something earlier
    // in the gesture chain called preventDefault).
    if (firedAtRef.current && e?.cancelable) {
      e.preventDefault();
    }
    startRef.current = null;
  }, [clearTimer]);

  const onTouchCancel = useCallback(() => {
    clearTimer();
    startRef.current = null;
    firedAtRef.current = 0;
  }, [clearTimer]);

  // Capture-phase suppression: stop the click only if it falls inside
  // the CLICK_SUPPRESS_MS window after a fired long-press. Outside
  // that window, the click passes through — important for keyboard
  // users who activate buttons via Enter/Space, which would otherwise
  // get permanently silenced after the first long-press on the row.
  const onClickCapture = useCallback((e) => {
    if (firedAtRef.current && Date.now() - firedAtRef.current < CLICK_SUPPRESS_MS) {
      firedAtRef.current = 0;
      e.stopPropagation();
      e.preventDefault();
    }
  }, []);

  return {
    bind: enabled ? { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onClickCapture } : {},
    didFire: () => firedAtRef.current > 0,
  };
}
