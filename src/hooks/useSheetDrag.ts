import { useCallback, useEffect, useRef } from "react";
import type { TouchEvent as ReactTouchEvent } from "react";

interface DragStart {
  y: number; x: number; dir: number; active: boolean; cancelled: boolean;
  lastY: number; lastT: number; vy: number; panelH: number;
}

/* ── Drag-to-dismiss + overscroll bounce for bottom sheets ─────────────
   Two gestures on the sheet panel:

   1. Drag to dismiss: when the user pulls down AND the inner scroll is
      at the top, the panel follows the finger. Past `threshold`px the
      panel animates off-screen and onClose() fires; below that it
      springs back.

   2. Overscroll bounce: when the user pulls up AND the inner scroll is
      already at the bottom (or the content fits so there's nothing to
      scroll), the panel rubber-bands a small amount and springs back
      on release. iOS Safari won't emit a native elastic bounce on
      short sheets (the scroll container doesn't overflow), so this
      gives the "nothing more" tactile feedback users expect.

   We mutate `transform` directly on the panel DOM node during the
   gesture instead of going through React state — every touchmove would
   otherwise schedule a re-render, which on a phone ends up trailing
   the finger and jittering. Only the close/open transitions touch
   React at all. */
export function useSheetDrag(onClose: () => void, { threshold = 92, isOpen = true }: { threshold?: number; isOpen?: boolean } = {}) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const panelElRef = useRef<HTMLElement | null>(null);
  const startRef = useRef<DragStart | null>(null);
  const closingRef = useRef(false);

  const writeTransform = (el: HTMLElement | null, y: number, transition?: string) => {
    if (!el) return;
    el.style.transition = transition || "";
    el.style.transform = y === 0 ? "" : `translateY(${y}px)`;
  };

  // Reset panel styling whenever the sheet is closed externally (e.g. X
  // button, overlay click). Without this, an in-flight drag offset
  // could carry over on next open.
  useEffect(() => {
    if (!isOpen) {
      closingRef.current = false;
      startRef.current = null;
      writeTransform(panelElRef.current, 0, "");
    }
  }, [isOpen]);

  // iOS-style rubber band: resistance grows with distance so the drag
  // feels "tethered" rather than linear. Tuned to feel close to native
  // UIScrollView overscroll.
  const rubberBand = (distance: number, dimension: number) => {
    const c = 0.5;
    const x = Math.abs(distance);
    const resist = (x * dimension * c) / (dimension + c * x);
    return Math.sign(distance) * resist;
  };

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    if (closingRef.current) return;
    const t = e.touches[0];
    // Skip drag-to-dismiss when the touch begins on an interactive
    // element. Inputs / textareas / selects / buttons / contenteditable
    // surfaces should behave like normal taps; without this guard the
    // 6px activation threshold below trips on the natural finger drift
    // of an iOS tap (5-10px is common), the panel translates a few
    // pixels, the iOS keyboard slides up onto a moved target, and the
    // input becomes glitchy / hard to focus. Sheet dismissal still
    // works from the handle, header, surrounding whitespace, or the
    // overlay click — the surface area for intentional drag is plenty.
    const target = e.target as Element | null;
    if (target?.closest && target.closest(
      "input, textarea, select, button, [contenteditable=true], [role='button'], [role='switch'], [role='checkbox'], [role='radio'], a[href]"
    )) {
      startRef.current = { y: 0, x: 0, dir: 0, active: false, cancelled: true, lastY: 0, lastT: 0, vy: 0, panelH: 0 };
      return;
    }
    startRef.current = {
      y: t.clientY,
      x: t.clientX,
      dir: 0, // 1 = drag-down (dismiss), -1 = overscroll-up (bounce)
      active: false,
      cancelled: false,
      // Velocity tracking for flick-to-dismiss. We low-pass the
      // per-move velocity so a natural quick flick dismisses even when
      // it hasn't travelled past the distance threshold — the single
      // biggest contributor to "feels heavy / unnatural" was that the
      // release decision used distance ONLY and ignored speed.
      lastY: t.clientY,
      lastT: e.timeStamp || performance.now(),
      vy: 0,
      // Capture the panel's height once so rubberBand can scale by it.
      panelH: panelElRef.current?.offsetHeight || window.innerHeight,
    };
    // Cancel any in-flight spring-back so the finger picks up from where
    // the panel currently is rather than fighting the transition.
    if (panelElRef.current) panelElRef.current.style.transition = "";
  }, []);

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    const s = startRef.current;
    if (!s || s.cancelled) return;
    const t = e.touches[0];
    const dy = t.clientY - s.y;
    const dx = t.clientX - s.x;
    const panel = panelElRef.current;
    if (!panel) return;

    // Track instantaneous vertical velocity (px/ms, + = downward), lightly
    // smoothed so one noisy sample doesn't dominate the release decision.
    const now = e.timeStamp || performance.now();
    const dt = now - s.lastT;
    if (dt > 0) {
      const inst = (t.clientY - s.lastY) / dt;
      s.vy = s.vy === 0 ? inst : s.vy * 0.4 + inst * 0.6;
      s.lastY = t.clientY;
      s.lastT = now;
    }

    if (!s.active) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        s.cancelled = true;
        return;
      }
      const scrollEl = scrollRef.current;
      const scrollTop = scrollEl?.scrollTop ?? 0;
      const scrollHeight = scrollEl?.scrollHeight ?? 0;
      const clientHeight = scrollEl?.clientHeight ?? 0;
      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;

      // 10px activation threshold (was 6) — gives a comfortable
      // dead-zone for taps on non-input regions (header text, sheet
      // background) so a casual finger drift doesn't trigger a
      // panel translation under the user's tap.
      if (dy > 10 && atTop) {
        s.active = true;
        s.dir = 1;
      } else if (dy < -10 && atBottom) {
        s.active = true;
        s.dir = -1;
      } else if (Math.abs(dy) > 8) {
        // Once the finger has moved noticeably without satisfying
        // the activation rule (e.g. dragging down while the inner
        // content is scrolled), abandon — don't lazily activate
        // later if the finger eventually scrolls back to top.
        s.cancelled = true;
        return;
      } else {
        return;
      }
    }

    if (s.dir === 1) {
      // Dismiss drag: finger 1:1 below start, rubber-band above start.
      const y = dy > 0 ? dy : rubberBand(dy, s.panelH);
      writeTransform(panel, y, "none");
    } else {
      // Overscroll bounce: rubber-band in both directions but clamp to
      // upward-only movement so the hint never reveals the page under.
      const y = Math.min(0, rubberBand(dy, s.panelH));
      writeTransform(panel, y, "none");
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    const s = startRef.current;
    startRef.current = null;
    const panel = panelElRef.current;
    if (!s?.active || !panel) return;

    // Read the current transform to decide snap vs dismiss. Reading from
    // the DOM keeps decisions honest even if a later touchmove raced
    // the end event.
    const matrix = new DOMMatrixReadOnly(getComputedStyle(panel).transform);
    const currentY = matrix.m42 || 0;

    // Dismiss when EITHER the panel was dragged past the distance
    // threshold OR the finger was moving down fast enough at release (a
    // flick). The flick path is what makes the gesture feel light: you
    // don't have to haul the sheet halfway down the screen — a natural
    // quick downward toss lets go and it leaves. A small travel floor
    // (24px) stops an accidental jitter at the very top from dismissing.
    const FLICK_VELOCITY = 0.55; // px/ms (~550 px/s)
    const FLICK_MIN_TRAVEL = 24; // px
    const flickDown = s.vy > FLICK_VELOCITY && currentY > FLICK_MIN_TRAVEL;
    const draggedFar = currentY > threshold;

    if (s.dir === 1 && (draggedFar || flickDown)) {
      // Continue the finger's momentum: a fast flick finishes quickly,
      // a slow drag-past-threshold eases out. Clamp so it never snaps
      // jarringly or drags. Curve has a steep start (picks up the
      // finger's motion) then decelerates into the edge.
      const remaining = Math.max(1, window.innerHeight - currentY);
      const v = Math.max(s.vy, 0.1);
      const durSec = Math.max(0.16, Math.min(0.34, remaining / v / 1000));
      closingRef.current = true;
      writeTransform(panel, window.innerHeight, `transform ${durSec}s cubic-bezier(0.3, 0.7, 0.1, 1)`);
      setTimeout(() => {
        closingRef.current = false;
        onClose();
      }, durSec * 1000);
    } else {
      // Snap back fast with a soft settle — the old 0.8s glide is what
      // read as "heavy". A ~0.34s ease-out feels like the sheet is light
      // and tethered, not dragging an anchor back into place.
      writeTransform(panel, 0, "transform 0.34s cubic-bezier(0.22, 1, 0.36, 1)");
    }
  }, [threshold, onClose]);

  // Callback ref: capture the panel DOM node for direct mutation.
  const setPanelEl = useCallback((el: HTMLElement | null) => {
    panelElRef.current = el;
  }, []);

  const panelHandlers = { onTouchStart, onTouchMove, onTouchEnd };

  return { scrollRef, setPanelEl, panelHandlers };
}
