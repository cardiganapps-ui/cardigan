import { useRef, useState, useCallback } from "react";

export function PullToRefresh({ onRefresh, children }) {
  const wrapRef = useRef(null);
  const touchRef = useRef(null);
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Track release so we can animate the collapse smoothly
  const [releasing, setReleasing] = useState(false);

  const THRESHOLD = 56;
  const MAX_PULL = 120;

  const isAtTop = () => {
    const page = wrapRef.current?.querySelector(".page");
    return !page || page.scrollTop <= 0;
  };

  const onTouchStart = useCallback((e) => {
    if (refreshing || releasing) return;
    if (!isAtTop()) return;
    touchRef.current = { y: e.touches[0].clientY, active: false };
  }, [refreshing, releasing]);

  const onTouchMove = useCallback((e) => {
    if (!touchRef.current || refreshing || releasing) return;
    const dy = e.touches[0].clientY - touchRef.current.y;
    if (!touchRef.current.active) {
      if (dy > 10 && isAtTop()) touchRef.current.active = true;
      else if (dy < -5) { touchRef.current = null; return; }
      else return;
    }
    if (touchRef.current.active && dy > 0) {
      // Rubber-band dampening: slows down as you pull further
      const ratio = 1 - Math.min(dy / 600, 0.7);
      setPullY(Math.min(MAX_PULL, dy * ratio * 0.5));
    }
  }, [refreshing, releasing]);

  const onTouchEnd = useCallback(async () => {
    if (!touchRef.current?.active) { touchRef.current = null; return; }
    touchRef.current = null;
    if (pullY >= THRESHOLD) {
      setRefreshing(true);
      setPullY(THRESHOLD);
      try { await onRefresh(); } finally {
        setRefreshing(false);
        setReleasing(true);
        setPullY(0);
        setTimeout(() => setReleasing(false), 300);
      }
    } else {
      setReleasing(true);
      setPullY(0);
      setTimeout(() => setReleasing(false), 300);
    }
  }, [pullY, onRefresh]);

  // Progress 0..1 based on pull distance toward threshold
  const progress = Math.min(1, pullY / THRESHOLD);
  const show = pullY > 0 || refreshing || releasing;

  // Spinner sizing
  const size = 22;
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  return (
    <div ref={wrapRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {show && (
        <div style={{
          display: "flex", justifyContent: "center", alignItems: "center",
          height: refreshing ? THRESHOLD : pullY,
          minHeight: refreshing ? THRESHOLD : 0,
          transition: (refreshing || releasing) ? "height 0.3s cubic-bezier(0.32, 0.72, 0, 1), min-height 0.3s cubic-bezier(0.32, 0.72, 0, 1)" : "none",
          flexShrink: 0, overflow: "hidden",
        }}>
          <div style={{
            opacity: refreshing ? 1 : Math.min(1, progress * 1.5),
            transform: refreshing
              ? "scale(1)"
              : `scale(${0.5 + progress * 0.5}) rotate(${progress * 270}deg)`,
            transition: releasing ? "opacity 0.2s ease, transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)" : "none",
          }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{
              display: "block",
              animation: refreshing ? "ptr-spin 0.75s cubic-bezier(0.4, 0, 0.2, 1) infinite" : "none",
            }}>
              <circle cx={size / 2} cy={size / 2} r={r}
                fill="none"
                stroke="var(--cream-deeper)"
                strokeWidth={stroke}
              />
              <circle cx={size / 2} cy={size / 2} r={r}
                fill="none"
                stroke="var(--teal)"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circ}
                strokeDashoffset={refreshing ? circ * 0.25 : circ * (1 - progress * 0.75)}
                style={{
                  transition: refreshing ? "stroke-dashoffset 0.3s ease" : "none",
                  transformOrigin: "center",
                }}
              />
            </svg>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
