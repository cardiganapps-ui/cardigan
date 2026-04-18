import { useCallback, useEffect, useRef, useState } from "react";

/* ── Drag-to-dismiss gesture for bottom sheets ──────────────────────────
   Returns handlers to spread on the sheet-panel and an optional `scrollRef`
   to attach to the inner scroll container. The hook only engages the drag
   when the finger moves down AND the inner scroll is at the top (otherwise
   it yields to native scrolling so scrolling through the sheet still feels
   normal). Past `threshold`px the panel animates off-screen and onClose()
   fires. Below the threshold it springs back.

   `scrollRef` is optional — if omitted, the hook uses the panel itself as
   the scroll reference, which works for panels where the whole panel is
   also the scroll container. */
export function useSheetDrag(onClose, { threshold = 110, isOpen = true } = {}) {
  const scrollRef = useRef(null);
  const startRef = useRef(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);

  // When the parent owns the hook instance but conditionally renders the
  // sheet (e.g. a Settings screen with multiple sheets), reset the drag
  // state whenever the sheet is closed so the next open starts fresh.
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
      // Horizontal-dominant gesture: bail out (let native handle it).
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        s.cancelled = true;
        return;
      }
      // Downward pull beyond a small deadzone AND inner scroll at top.
      const scrollEl = scrollRef.current;
      const atTop = !scrollEl || scrollEl.scrollTop <= 0;
      if (dy > 8 && atTop) {
        s.active = true;
        setDragging(true);
      } else if (dy < -4) {
        // Upward scroll — don't engage drag, let the content scroll.
        s.cancelled = true;
        return;
      } else {
        return;
      }
    }

    if (s.active) {
      // Resist a bit so the drag feels tethered rather than linear.
      const resisted = dy > 0 ? dy : dy * 0.2;
      setDragY(resisted);
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    const s = startRef.current;
    startRef.current = null;
    if (!s?.active) return;
    setDragging(false);
    if (dragY > threshold) {
      setClosing(true);
      setDragY(window.innerHeight);
      setTimeout(() => {
        onClose();
      }, 260);
    } else {
      setDragY(0);
    }
  }, [dragY, threshold, onClose]);

  const panelStyle = {
    transform: dragY !== 0 ? `translateY(${dragY}px)` : undefined,
    transition: dragging ? "none" : "transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
    touchAction: "pan-y",
  };

  const panelHandlers = { onTouchStart, onTouchMove, onTouchEnd };

  return { scrollRef, panelHandlers, panelStyle, dragging };
}
