import { useCallback, useEffect, useRef } from "react";

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
export function useSheetDrag(onClose, { threshold = 110, isOpen = true } = {}) {
  const scrollRef = useRef(null);
  const panelElRef = useRef(null);
  const startRef = useRef(null);
  const closingRef = useRef(false);

  const writeTransform = (el, y, transition) => {
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
  const rubberBand = (distance, dimension) => {
    const c = 0.55;
    const x = Math.abs(distance);
    const resist = (x * dimension * c) / (dimension + c * x);
    return Math.sign(distance) * resist;
  };

  const onTouchStart = useCallback((e) => {
    if (closingRef.current) return;
    const t = e.touches[0];
    startRef.current = {
      y: t.clientY,
      x: t.clientX,
      dir: 0, // 1 = drag-down (dismiss), -1 = overscroll-up (bounce)
      active: false,
      cancelled: false,
      // Capture the panel's height once so rubberBand can scale by it.
      panelH: panelElRef.current?.offsetHeight || window.innerHeight,
    };
    // Cancel any in-flight spring-back so the finger picks up from where
    // the panel currently is rather than fighting the transition.
    if (panelElRef.current) panelElRef.current.style.transition = "";
  }, []);

  const onTouchMove = useCallback((e) => {
    const s = startRef.current;
    if (!s || s.cancelled) return;
    const t = e.touches[0];
    const dy = t.clientY - s.y;
    const dx = t.clientX - s.x;
    const panel = panelElRef.current;
    if (!panel) return;

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

      if (dy > 6 && atTop) {
        s.active = true;
        s.dir = 1;
      } else if (dy < -6 && atBottom) {
        s.active = true;
        s.dir = -1;
      } else if (Math.abs(dy) > 4) {
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

    // Silky decelerate, no overshoot — matches iOS rubber-band release.
    const springBack = "transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)";
    const dismiss    = "transform 0.32s cubic-bezier(0.32, 0.72, 0.0, 1)";

    if (s.dir === 1 && currentY > threshold) {
      closingRef.current = true;
      writeTransform(panel, window.innerHeight, dismiss);
      setTimeout(() => {
        closingRef.current = false;
        onClose();
      }, 320);
    } else {
      writeTransform(panel, 0, springBack);
    }
  }, [threshold, onClose]);

  // Callback ref: capture the panel DOM node for direct mutation.
  const setPanelEl = useCallback((el) => {
    panelElRef.current = el;
  }, []);

  const panelHandlers = { onTouchStart, onTouchMove, onTouchEnd };

  return { scrollRef, setPanelEl, panelHandlers };
}
