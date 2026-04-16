import { useRef, useState, useCallback } from "react";
import { LogoIcon } from "./LogoMark";

export function PullToRefresh({ onRefresh, children }) {
  const wrapRef = useRef(null);
  const touchRef = useRef(null);
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [done, setDone] = useState(false);

  const THRESHOLD = 64;
  const MAX_PULL = 130;

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
        setDone(true);
        setRefreshing(false);
        setTimeout(() => {
          setReleasing(true);
          setPullY(0);
          setTimeout(() => {
            setReleasing(false);
            setDone(false);
          }, 500);
        }, 600);
      }
    } else {
      setReleasing(true);
      setPullY(0);
      setTimeout(() => setReleasing(false), 400);
    }
  }, [pullY, onRefresh]);

  const progress = Math.min(1, pullY / THRESHOLD);
  const show = pullY > 0 || refreshing || releasing || done;

  return (
    <div ref={wrapRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {show && (
        <div className="ptr-container" style={{
          display: "flex", justifyContent: "center", alignItems: "center",
          flexDirection: "column", gap: 6,
          height: refreshing || done ? THRESHOLD : pullY,
          minHeight: refreshing || done ? THRESHOLD : 0,
          transition: (refreshing || releasing || done) ? "height 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), min-height 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)" : "none",
          flexShrink: 0, overflow: "hidden",
        }}>
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            opacity: done ? 1 : refreshing ? 1 : Math.min(1, progress * 1.5),
            transform: done
              ? "scale(1)"
              : refreshing
                ? "scale(1)"
                : `scale(${0.3 + progress * 0.7}) rotate(${progress * 180}deg)`,
            transition: (releasing || done)
              ? "opacity 0.6s ease, transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)"
              : "none",
          }}>
            {done ? (
              /* Success checkmark */
              <svg width={24} height={24} viewBox="0 0 24 24" fill="none" style={{
                animation: "ptr-check-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}>
                <circle cx={12} cy={12} r={11} stroke="var(--green)" strokeWidth={2} fill="var(--green-bg)" />
                <path d="M7 12.5L10.5 16L17 9" stroke="var(--green)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                  style={{ strokeDasharray: 20, strokeDashoffset: 0, animation: "ptr-check-draw 0.4s ease 0.1s both" }} />
              </svg>
            ) : (
              /* Logo spinner */
              <div style={{
                width: 28, height: 28,
                animation: refreshing ? "ptr-breathe 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite" : "none",
              }}>
                <LogoIcon size={28} color={refreshing ? "var(--teal)" : `rgba(91, 155, 175, ${0.3 + progress * 0.7})`} />
              </div>
            )}
          </div>
          {done && (
            <span style={{
              fontSize: 11, fontWeight: 700, color: "var(--green)",
              fontFamily: "var(--font-d)", letterSpacing: "0.02em",
              animation: "ptr-text-in 0.4s ease 0.15s both",
            }}>
              Actualizado
            </span>
          )}
          {refreshing && (
            <span style={{
              fontSize: 10, fontWeight: 600, color: "var(--charcoal-xl)",
              fontFamily: "var(--font)",
              animation: "ptr-text-in 0.4s ease both",
            }}>
              Actualizando...
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
