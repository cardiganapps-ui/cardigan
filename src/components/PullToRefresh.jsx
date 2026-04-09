import { useRef, useState, useCallback } from "react";

export function PullToRefresh({ onRefresh, children }) {
  const wrapRef = useRef(null);
  const touchRef = useRef(null);
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const THRESHOLD = 28;

  const isAtTop = () => {
    // Find the .page element inside wrapper
    const page = wrapRef.current?.querySelector(".page");
    return !page || page.scrollTop <= 0;
  };

  const onTouchStart = useCallback((e) => {
    if (refreshing || !isAtTop()) return;
    touchRef.current = { y: e.touches[0].clientY, active: false };
  }, [refreshing]);

  const onTouchMove = useCallback((e) => {
    if (!touchRef.current || refreshing) return;
    const dy = e.touches[0].clientY - touchRef.current.y;
    if (!touchRef.current.active) {
      if (dy > 10 && isAtTop()) touchRef.current.active = true;
      else if (dy < -5) { touchRef.current = null; return; }
      else return;
    }
    if (touchRef.current.active && dy > 0) {
      setPullY(Math.min(100, dy * 0.35));
    }
  }, [refreshing]);

  const onTouchEnd = useCallback(async () => {
    if (!touchRef.current?.active) { touchRef.current = null; return; }
    touchRef.current = null;
    if (pullY >= THRESHOLD) {
      setRefreshing(true);
      setPullY(THRESHOLD);
      await onRefresh();
      setRefreshing(false);
    }
    setPullY(0);
  }, [pullY, onRefresh]);

  return (
    <div ref={wrapRef} style={{ flex:1, display:"flex", flexDirection:"column", position:"relative", overflow:"hidden" }}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {(pullY > 0 || refreshing) && (
        <div style={{
          display:"flex", justifyContent:"center", alignItems:"center",
          height: pullY, minHeight: refreshing ? THRESHOLD : 0,
          transition: refreshing || pullY === 0 ? "height 0.2s ease, min-height 0.2s ease" : "none",
          flexShrink:0,
        }}>
          <div style={{
            width:20, height:20, borderRadius:"50%",
            border:"2.5px solid var(--cream-deeper)",
            borderTopColor: pullY >= THRESHOLD || refreshing ? "var(--teal)" : "var(--cream-deeper)",
            animation: refreshing ? "spin 0.6s linear infinite" : "none",
          }} />
        </div>
      )}
      {children}
    </div>
  );
}
