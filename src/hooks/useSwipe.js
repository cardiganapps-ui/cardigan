import { useRef, useState, useCallback, useEffect } from "react";
import { IN_SCREEN_SWIPE_DEAD_ZONE, isOwned, isOwnedBy, release, tryClaim } from "./swipeCoordinator";

/* ── useSwipe ──
   3-panel horizontal strip with finger-follow + settle-and-commit.
   Used by Agenda's day / week / month navigation.

   Gesture safety:
     - Ignores touches starting in the left-edge dead zone so App.jsx's
       drawer edge-swipe can claim them unambiguously.
     - Claims the global swipe coordinator on activation; if the
       drawer (or any other horizontal-swipe owner) already holds it
       we bail out. This is the case a dead zone alone can't cover:
       a finger that starts outside the band but drifts back toward
       the edge while the drawer has already taken ownership.
     - Resets all state on touchcancel (iOS cancels gestures on
       multi-touch, incoming calls, system edge-swipe). Without this,
       ref.current and offset/swiping flags leaked into the next
       gesture — visible as a phantom "half-swipe" on the first touch
       after nav/drawer use.
*/

const OWNER_ID = "in-screen-swipe";

export function useSwipe(onLeft, onRight) {
  const ref = useRef(null);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [settling, setSettling] = useState(false);
  // Pending settle-animation timer. Tracked so it can be cancelled on
  // unmount (e.g. user navigates mid-settle) — without this, the
  // queued setOffset/setSettling/onLeft fire against an unmounted
  // hook and the navigation callback may run against stale screen
  // state.
  const settleTimerRef = useRef(null);
  const cancelSettleTimer = useCallback(() => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  // Release the coordinator lock + cancel any pending settle timer
  // on unmount. The owner screen may unmount mid-gesture (user nav
  // while settling) and we don't want the queued callbacks to run
  // against a detached component.
  useEffect(() => () => {
    cancelSettleTimer();
    release(OWNER_ID);
  }, [cancelSettleTimer]);

  const resetGesture = useCallback(() => {
    ref.current = null;
    setSwiping(false);
    setOffset(0);
    setSettling(false);
    cancelSettleTimer();
    release(OWNER_ID);
  }, [cancelSettleTimer]);

  const onTouchStart = useCallback((e) => {
    // Defensive: if a stale ref lingers from an aborted gesture,
    // drop it before deciding on the new touch.
    ref.current = null;
    if (e.touches[0].clientX < IN_SCREEN_SWIPE_DEAD_ZONE) return;
    // If another swipe handler already owns the gesture (typically the
    // drawer edge-swipe claimed mid-drag), don't start a competing one.
    if (isOwned() && !isOwnedBy(OWNER_ID)) return;
    ref.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, active: false };
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!ref.current) return;
    // If ownership flipped to another handler while we were tracking
    // (edge-swipe took over), fold this gesture out cleanly.
    if (isOwned() && !isOwnedBy(OWNER_ID)) {
      resetGesture();
      return;
    }
    const dx = e.touches[0].clientX - ref.current.x;
    const dy = e.touches[0].clientY - ref.current.y;
    if (!ref.current.active) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        // Claim the lock at the moment we commit to a horizontal swipe.
        // If the claim fails (drawer just took it), abort silently.
        if (!tryClaim(OWNER_ID)) { ref.current = null; return; }
        ref.current.active = true;
        setSwiping(true);
      } else if (Math.abs(dy) > 10) {
        ref.current = null;
        return;
      } else return;
    }
    if (ref.current.active) setOffset(dx);
  }, [resetGesture]);

  const onTouchEnd = useCallback((e) => {
    if (!ref.current?.active) {
      ref.current = null;
      release(OWNER_ID);
      return;
    }
    const dx = e.changedTouches[0].clientX - ref.current.x;
    ref.current = null;
    setSwiping(false);

    const triggered = Math.abs(dx) > 80;

    // Cancel any prior settle timer — a rapid swipe-end-swipe-end
    // sequence shouldn't stack two timers, both of which would call
    // onLeft / onRight against the navigation state at fire-time.
    cancelSettleTimer();

    if (triggered) {
      // Animate to full panel width, then navigate. Keep the lock until
      // the settle animation completes so a racing edge-swipe can't
      // start while the strip is still in motion.
      const dir = dx < 0 ? -1 : 1;
      setSettling(true);
      setOffset(dir * window.innerWidth);
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        if (dx < -80) onLeft();
        else onRight();
        setOffset(0);
        setSettling(false);
        release(OWNER_ID);
      }, 250);
    } else {
      // Snap back
      setSettling(true);
      setOffset(0);
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        setSettling(false);
        release(OWNER_ID);
      }, 250);
    }
  }, [onLeft, onRight, cancelSettleTimer]);

  const onTouchCancel = useCallback(() => {
    resetGesture();
  }, [resetGesture]);

  // The offset for the 3-panel strip: center panel starts at -100% (of container width / 3)
  // Container is 300% wide, showing the middle third by default
  const stripTranslate = swiping || settling ? offset : 0;

  const containerProps = {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    // touch-action: pan-y reserves vertical pans for native scroll while
    // letting our JS handle horizontal swipes — keeps the page scrollable
    // even when the swipeable region covers the full viewport.
    style: { overflow: "hidden", touchAction: "pan-y" },
  };

  const stripStyle = {
    display: "flex",
    width: "300%",
    transform: `translateX(calc(-33.333% + ${stripTranslate}px))`,
    transition: settling ? "transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)" : swiping ? "none" : undefined,
    willChange: swiping || settling ? "transform" : undefined,
  };

  const panelStyle = {
    width: "33.333%",
    flexShrink: 0,
  };

  return { containerProps, stripStyle, panelStyle };
}
