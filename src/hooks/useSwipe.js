import { useRef, useState, useCallback } from "react";

export function useSwipe(onLeft, onRight) {
  const ref = useRef(null);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [settling, setSettling] = useState(false);

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

    const triggered = Math.abs(dx) > 80;

    if (triggered) {
      // Animate to full panel width, then navigate
      const dir = dx < 0 ? -1 : 1;
      setSettling(true);
      setOffset(dir * window.innerWidth);
      setTimeout(() => {
        if (dx < -80) onLeft();
        else onRight();
        setOffset(0);
        setSettling(false);
      }, 250);
    } else {
      // Snap back
      setSettling(true);
      setOffset(0);
      setTimeout(() => setSettling(false), 250);
    }
  }, [onLeft, onRight]);

  // The offset for the 3-panel strip: center panel starts at -100% (of container width / 3)
  // Container is 300% wide, showing the middle third by default
  const stripTranslate = swiping || settling ? offset : 0;

  const containerProps = {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    // touch-action: pan-y reserves vertical pans for native scroll while
    // letting our JS handle horizontal swipes — keeps the page scrollable
    // even when the swipeable region covers the full viewport.
    style: { overflow: "hidden", touchAction: "pan-y" },
  };

  const stripStyle = {
    display: "flex",
    width: "300%",
    transform: `translateX(calc(-33.333% + ${stripTranslate}px))`,
    transition: settling ? "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)" : swiping ? "none" : undefined,
    willChange: swiping || settling ? "transform" : undefined,
  };

  const panelStyle = {
    width: "33.333%",
    flexShrink: 0,
  };

  return { containerProps, stripStyle, panelStyle };
}
