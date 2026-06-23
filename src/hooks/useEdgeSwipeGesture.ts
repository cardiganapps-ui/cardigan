import { useEffect } from "react";
import type { MutableRefObject } from "react";
import { DRAWER_EDGE_BAND, release as releaseSwipe, tryClaim as trySwipeClaim } from "./swipeCoordinator";

/* ── useEdgeSwipeGesture ──────────────────────────────────────────────
   Left-edge swipe-to-open for the navigation drawer on touch (phone)
   layouts. Extracted verbatim from App.tsx so the App shell stops
   owning ~150 lines of raw touch-event plumbing and the open/commit
   decision becomes unit-testable in isolation.

   Two jobs, both load-bearing:
     1. Open the drawer when a left-edge drag crosses the commit
        threshold (distance OR velocity — see shouldCommitDrawerOpen).
     2. Suppress iOS Safari's native edge-swipe-back "peek" the moment
        motion is clearly horizontal, so the previous-history page never
        flashes behind our sliding content / open drawer.

   Disabled at ≥768px (isTablet) where the sidebar is persistent and an
   edge gesture would be meaningless. The caller owns the refs + the
   drawer/swipe-progress state; this hook only wires the listeners. */

const EDGE_OWNER_ID = "drawer-edge";

// Commit thresholds for turning a left-edge drag into an "open drawer".
// Either a long-enough pull OR a fast-enough flick commits.
export const OPEN_DISTANCE_PX = 100;
export const OPEN_VELOCITY_PX_PER_MS = 0.3;

/** Pure open/commit decision — the behavioral heart of the gesture.
    `dx` is horizontal travel (px, rightward positive); `elapsedMs` is
    the drag duration. A non-positive/elapsed-0 drag never commits. */
export function shouldCommitDrawerOpen(dx: number, elapsedMs: number): boolean {
  if (!(elapsedMs > 0)) return dx > OPEN_DISTANCE_PX;
  const velocity = dx / elapsedMs;
  return dx > OPEN_DISTANCE_PX || velocity > OPEN_VELOCITY_PX_PER_MS;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export interface EdgeSwipeOptions {
  shellRef: MutableRefObject<HTMLElement | null>;
  edgeRef: MutableRefObject<Row>;
  drawerOpenRef: MutableRefObject<boolean>;
  screenSlidingRef: MutableRefObject<boolean>;
  isTablet: boolean;
  setSwipeProgress: (v: number) => void;
  setDrawerOpen: (v: boolean) => void;
}

export function useEdgeSwipeGesture({
  shellRef, edgeRef, drawerOpenRef, screenSlidingRef,
  isTablet, setSwipeProgress, setDrawerOpen,
}: EdgeSwipeOptions) {
  useEffect(() => {
    // Skip edge-swipe-to-open entirely once the sidebar is persistent
    // (≥768px). Catching a touchstart on the left edge would be confusing
    // when the drawer is already visible. Mobile (iPhone) keeps the gesture.
    if (isTablet) return;
    const shell = shellRef.current;
    if (!shell) return;

    const onTouchStart = (e: TouchEvent) => {
      // DRAWER_EDGE_BAND is shared with useSwipe's IN_SCREEN_SWIPE_DEAD_ZONE
      // so the two gesture owners never race at start.
      const inEdgeBand = e.touches[0].clientX < DRAWER_EDGE_BAND;
      if (drawerOpenRef.current) {
        // Drawer is already open. We must NOT kick off a second open
        // animation — but we DO need to claim left-edge horizontal
        // touches so iOS Safari's native "edge-swipe-back" peel-the-
        // previous-page gesture doesn't fire under the drawer panel.
        // Without this, swiping right from the left edge while the
        // drawer is open shows the previous browser-history page
        // peeking out behind the drawer (the "weird thing" reported).
        if (inEdgeBand) {
          edgeRef.current = {
            startX: e.touches[0].clientX,
            startY: e.touches[0].clientY,
            time: Date.now(),
            active: false,
            suppressOnly: true, // block iOS gesture, no app-side animation
          };
        } else {
          edgeRef.current = null;
        }
        return;
      }
      if (inEdgeBand) {
        edgeRef.current = {
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          time: Date.now(),
          active: false,
          // When the screen is mid-slide we DON'T open the drawer (the
          // double animation reads as glitchy), but we MUST still
          // claim and prevent-default the gesture — otherwise iOS
          // Safari's native edge-swipe-back peek runs unimpeded and
          // paints the previous page next to our sliding content.
          // That was the "two screens side by side with a half-open
          // drawer" glitch reported by a user. We track-but-suppress.
          blockedByAnim: screenSlidingRef.current,
        };
      } else {
        edgeRef.current = null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!edgeRef.current) return;
      const dx = e.touches[0].clientX - edgeRef.current.startX;
      const dy = e.touches[0].clientY - edgeRef.current.startY;
      // suppressOnly path (drawer already open): block iOS's native
      // edge-swipe-back as soon as motion is clearly horizontal, but
      // never claim the swipe coordinator and never update drawer
      // state — the drawer is already open; there's nothing to do.
      if (edgeRef.current.suppressOnly) {
        if (Math.abs(dx) > 4 && Math.abs(dx) > Math.abs(dy)) {
          if (e.cancelable) e.preventDefault();
        } else if (Math.abs(dy) > 10) {
          // Vertical scroll — release the gesture so the drawer
          // panel's own scroll handler can take over.
          edgeRef.current = null;
        }
        return;
      }
      if (drawerOpenRef.current) return;
      // Suppress iOS Safari's native edge-swipe-back AS EARLY AS
      // possible. iOS makes its mind up about back-peek within the
      // first ~5px of horizontal motion — calling preventDefault
      // only AFTER our 10px engagement threshold lets iOS paint the
      // previous-history page during the gap (the "swipe opened a
      // brief flash of the previous screen" glitch). As soon as
      // we see clearly-horizontal motion, claim the gesture by
      // preventDefault'ing every move; the 10px threshold below
      // still gates whether we engage the drawer animation.
      if (!edgeRef.current.active && Math.abs(dx) > 4 && Math.abs(dx) > Math.abs(dy)) {
        if (e.cancelable) e.preventDefault();
      }
      if (!edgeRef.current.active) {
        if (dx > 10 && Math.abs(dx) > Math.abs(dy)) {
          // Claim exclusive ownership of the horizontal-swipe arbiter.
          // If some other handler already owns it (unlikely at start,
          // but possible during settle animations), back off.
          if (!trySwipeClaim(EDGE_OWNER_ID)) {
            edgeRef.current = null;
            return;
          }
          edgeRef.current.active = true;
        } else if (Math.abs(dy) > 10 || dx < -5) {
          edgeRef.current = null;
          return;
        } else return;
      }
      if (edgeRef.current.active) {
        // Continue suppressing back-peek through the rest of the drag.
        if (e.cancelable) e.preventDefault();
        if (!edgeRef.current.blockedByAnim) {
          setSwipeProgress(Math.max(0, dx));
        }
      }
    };

    const finishGesture = (e: TouchEvent) => {
      if (!edgeRef.current?.active) {
        edgeRef.current = null;
        releaseSwipe(EDGE_OWNER_ID);
        setSwipeProgress(0);
        return;
      }
      const dx = e.changedTouches[0].clientX - edgeRef.current.startX;
      const elapsed = Date.now() - edgeRef.current.time;
      const blocked = edgeRef.current.blockedByAnim;
      edgeRef.current = null;
      if (!blocked && shouldCommitDrawerOpen(dx, elapsed)) {
        setDrawerOpen(true);
      }
      setSwipeProgress(0);
      // Release AFTER setSwipeProgress so any in-flight render reads
      // "still owned" and won't kick off a competing in-screen swipe.
      releaseSwipe(EDGE_OWNER_ID);
    };

    const onTouchCancel = () => {
      // Cancelled gesture — reset everything without committing.
      edgeRef.current = null;
      setSwipeProgress(0);
      releaseSwipe(EDGE_OWNER_ID);
    };

    shell.addEventListener("touchstart", onTouchStart, { passive: true });
    shell.addEventListener("touchmove", onTouchMove, { passive: false });
    shell.addEventListener("touchend", finishGesture, { passive: true });
    shell.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      shell.removeEventListener("touchstart", onTouchStart);
      shell.removeEventListener("touchmove", onTouchMove);
      shell.removeEventListener("touchend", finishGesture);
      shell.removeEventListener("touchcancel", onTouchCancel);
      releaseSwipe(EDGE_OWNER_ID);
    };
    // Deliberately subscribes only on isTablet changes — the refs and
    // state setters are stable, matching the original App.tsx effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTablet]);
}
