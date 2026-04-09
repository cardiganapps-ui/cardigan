import { useRef, useState, useCallback } from "react";

export function useSwipe(onLeft, onRight) {
  const ref = useRef(null);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [animating, setAnimating] = useState(false);

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
    if (ref.current.active) setOffset(dx * 0.5);
  }, []);

  const onTouchEnd = useCallback((e) => {
    if (!ref.current?.active) { ref.current = null; return; }
    const dx = e.changedTouches[0].clientX - ref.current.x;
    ref.current = null;
    setSwiping(false);

    const triggered = Math.abs(dx) > 80;
    const direction = dx < 0 ? -1 : 1;

    if (triggered) {
      // Slide off-screen, then navigate
      setAnimating(true);
      setOffset(direction * -window.innerWidth);
      setTimeout(() => {
        if (dx < -80) onLeft();
        else onRight();
        setOffset(0);
        setAnimating(false);
      }, 200);
    } else {
      // Snap back smoothly
      setAnimating(true);
      setOffset(0);
      setTimeout(() => setAnimating(false), 200);
    }
  }, [onLeft, onRight]);

  let style;
  if (swiping) {
    style = { transform: `translateX(${offset}px)`, transition: "none", willChange: "transform" };
  } else if (animating) {
    style = { transform: `translateX(${offset}px)`, transition: "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)", willChange: "transform" };
  } else {
    style = undefined;
  }

  return { onTouchStart, onTouchMove, onTouchEnd, style };
}
