import { useCallback, useEffect, useRef, useState } from "react";

/* ── Drag-to-dismiss + overscroll bounce for bottom sheets ─────────────
   Handles two gestures on the sheet panel:

   1. Drag to dismiss: when the user pulls down AND the inner scroll is
      at the top, the panel follows the finger. Past `threshold`px the
      panel animates off-screen and onClose() fires; below that it
      springs back.

   2. Overscroll bounce: when the user pulls up AND the inner scroll is
      already at the bottom (or the content fits so there's nothing to
      scroll), we translate the panel a small amount and spring back on
      release. iOS Safari won't emit a native elastic bounce on short
      sheets (the scroll container doesn't overflow), so this gives the
      "nothing more" tactile feedback users expect.

   `scrollRef` should point at the element whose scrollTop/scrollHeight
   are meaningful. For sheets where the panel itself is the scroll
   container, assign the same element to both panelRef and scrollRef. */
export function useSheetDrag(onClose, { threshold = 110, isOpen = true } = {}) {
  const scrollRef = useRef(null);
  const startRef = useRef(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setDragY(0);
      setDragging(false);
      setClosing(false);
      startRef.current = null;
    }
  }, [isOpen]);

  const onTouchStart = useCallback((e) => {
    if (closing) return;
    const t = e.touches[0];
    startRef.current = {
      y: t.clientY,
      x: t.clientX,
      dir: 0, // 1 = drag-down (dismiss), -1 = overscroll-up (bounce)
      active: false,
      cancelled: false,
    };
  }, [closing]);

  const onTouchMove = useCallback((e) => {
    const s = startRef.current;
    if (!s || s.cancelled) return;
    const t = e.touches[0];
    const dy = t.clientY - s.y;
    const dx = t.clientX - s.x;

    if (!s.active) {
      // Horizontal-dominant gesture: bail out.
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

      if (dy > 8 && atTop) {
        // Pull down at top → dismiss gesture.
        s.active = true;
        s.dir = 1;
        setDragging(true);
      } else if (dy < -8 && atBottom) {
        // Pull up at bottom (or short sheet with nothing to scroll) →
        // rubber-band bounce; never dismisses.
        s.active = true;
        s.dir = -1;
        setDragging(true);
      } else if (Math.abs(dy) > 4) {
        // Movement that doesn't match either gesture — let native
        // scrolling (if any) run and don't re-check on later moves.
        s.cancelled = true;
        return;
      } else {
        return;
      }
    }

    if (s.active) {
      if (s.dir === 1) {
        // Dismiss drag: track finger, with soft resistance above start.
        const resisted = dy > 0 ? dy : dy * 0.2;
        setDragY(resisted);
      } else {
        // Overscroll bounce: heavier resistance, capped so it's a hint
        // rather than a drag. Negative translateY moves panel upward.
        const raw = Math.min(0, dy);
        const resisted = Math.max(-80, raw * 0.35);
        setDragY(resisted);
      }
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    const s = startRef.current;
    startRef.current = null;
    if (!s?.active) return;
    setDragging(false);
    if (s.dir === 1 && dragY > threshold) {
      setClosing(true);
      setDragY(window.innerHeight);
      setTimeout(() => {
        onClose();
      }, 260);
    } else {
      setDragY(0);
    }
  }, [dragY, threshold, onClose]);

  const hasInteracted = dragY !== 0 || dragging || closing;
  const panelStyle = hasInteracted
    ? {
        transform: dragY !== 0 ? `translateY(${dragY}px)` : undefined,
        transition: dragging ? "none" : "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      }
    : {};

  const panelHandlers = { onTouchStart, onTouchMove, onTouchEnd };

  return { scrollRef, panelHandlers, panelStyle, dragging };
}
