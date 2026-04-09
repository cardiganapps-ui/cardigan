import { useRef, useState, useCallback } from "react";

export function useSwipe(onLeft, onRight) {
  const ref = useRef(null);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const onTouchStart = useCallback((e) => {
    if (e.touches[0].clientX < 30) return;
    ref.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, active: false };
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!ref.current) return;
    const dx = e.touches[0].clientX - ref.current.x;
    const dy = e.touches[0].clientY - ref.current.y;
    if (!ref.current.active) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        ref.current.active = true;
        setSwiping(true);
      } else if (Math.abs(dy) > 10) {
        ref.current = null;
        return;
      } else return;
    }
    if (ref.current.active) setOffset(dx);
  }, []);

  const onTouchEnd = useCallback((e) => {
    if (!ref.current?.active) { ref.current = null; return; }
    const dx = e.changedTouches[0].clientX - ref.current.x;
    ref.current = null;
    setSwiping(false);
    setOffset(0);
    if (dx < -80) onLeft();
    else if (dx > 80) onRight();
  }, [onLeft, onRight]);

  const style = swiping
    ? { transform: `translateX(${offset}px)`, transition: "none", willChange: "transform" }
    : undefined;

  return { onTouchStart, onTouchMove, onTouchEnd, style };
}
