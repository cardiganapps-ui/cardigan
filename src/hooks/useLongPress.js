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
   they need to. */

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE = 10;

export function useLongPress(onLongPress, { enabled = true, ms = LONG_PRESS_MS } = {}) {
  const timerRef = useRef(null);
  const startRef = useRef(null);
  const firedRef = useRef(false);

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
    firedRef.current = false;
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      firedRef.current = true;
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
    // If the long-press already fired, swallow the synthetic click
    // that follows (otherwise the row's onClick handler runs right on
    // top of the context menu and the menu's tap-outside listener
    // closes the menu immediately).
    if (firedRef.current && e?.cancelable) {
      e.preventDefault();
    }
    startRef.current = null;
  }, [clearTimer]);

  const onTouchCancel = useCallback(() => {
    clearTimer();
    startRef.current = null;
    firedRef.current = false;
  }, [clearTimer]);

  // Suppress the click that follows a fired long-press — capture-phase
  // so it runs before the row's onClick.
  const onClickCapture = useCallback((e) => {
    if (firedRef.current) {
      firedRef.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }, []);

  return {
    bind: enabled ? { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onClickCapture } : {},
    didFire: () => firedRef.current,
  };
}
