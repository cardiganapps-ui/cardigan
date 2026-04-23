import { useState, useCallback, useRef } from "react";
import { haptic } from "../utils/haptics";
import { tryClaim as trySwipeClaim, release as releaseSwipe } from "../hooks/swipeCoordinator";

const ROW_OWNER_ID = "swipeable-row";

/* ── Swipeable row ──
   Reveals a 80px-wide action slot to the right of the content when the
   user swipes left. Tapping the revealed action fires onAction and snaps
   back. Originally lived inline in Notes.jsx; pulled out so session and
   payment lists can reuse the same idiom (matches Apple Mail / Notes
   convention for destructive actions on list rows).

   Usage:
     <SwipeableRow onAction={...} actionLabel="Eliminar" actionTone="danger">
       <div className="row-item">...</div>
     </SwipeableRow> */

const REVEAL_PX = -80;
const ACTIVATE_PX = -40;

const TONE_BG = {
  danger: "var(--red)",
  success: "var(--green)",
  warn: "var(--amber)",
};

export function SwipeableRow({ children, onAction, actionLabel, actionTone = "danger" }) {
  const ref = useRef(null);
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const [swiping, setSwiping] = useState(false);
  const revealedRef = useRef(false);

  // Keep ref in sync so touch handlers see the latest committed offset
  // without re-binding on every render.
  offsetRef.current = offset;

  const onTouchStart = useCallback((e) => {
    ref.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      startOffset: offsetRef.current,
      active: false,
    };
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!ref.current) return;
    const dx = e.touches[0].clientX - ref.current.x;
    const dy = e.touches[0].clientY - ref.current.y;
    const revealed = ref.current.startOffset < 0;
    if (!ref.current.active) {
      const horizontal = Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy);
      const leftward = dx < 0;
      if (horizontal && (revealed || leftward)) {
        // Claim the global horizontal-swipe lock so an ancestor handler
        // (e.g. PatientExpediente's tab-swipe on .expediente-scroll)
        // can't also process this finger and hijack it as a tab change.
        // If something else already owns (rare — only if the touch
        // started inside another active swipe), back off cooperatively.
        if (!trySwipeClaim(ROW_OWNER_ID)) {
          ref.current = null;
          return;
        }
        ref.current.active = true;
        setSwiping(true);
      } else if (Math.abs(dy) > 8 || (!revealed && dx > 5)) {
        ref.current = null;
        return;
      } else return;
    }
    if (ref.current.active) {
      const next = ref.current.startOffset + dx;
      setOffset(Math.min(0, Math.max(REVEAL_PX, next)));
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!ref.current?.active) { ref.current = null; releaseSwipe(ROW_OWNER_ID); return; }
    ref.current = null;
    setSwiping(false);
    setOffset(prev => {
      const reveal = prev < ACTIVATE_PX;
      if (reveal && !revealedRef.current) haptic.tap();
      revealedRef.current = reveal;
      return reveal ? REVEAL_PX : 0;
    });
    releaseSwipe(ROW_OWNER_ID);
  }, []);

  // Touch can be system-cancelled (e.g. iOS edge-back gesture). Without
  // this, a leaked claim would block every subsequent horizontal swipe
  // app-wide until a fresh row gesture happened to release.
  const onTouchCancel = useCallback(() => {
    ref.current = null;
    setSwiping(false);
    releaseSwipe(ROW_OWNER_ID);
  }, []);

  const background = TONE_BG[actionTone] || TONE_BG.danger;

  return (
    <div style={{ position:"relative", overflow:"hidden", borderRadius:"var(--radius)" }}>
      <div
        style={{
          position:"absolute", top:0, right:0, bottom:0, width:80,
          display:"flex", alignItems:"center", justifyContent:"center",
          background, color:"var(--white)",
          fontSize:"var(--text-xs)", fontWeight:700, cursor:"pointer",
          borderRadius:"0 var(--radius) var(--radius) 0",
        }}
        onClick={() => {
          setOffset(0);
          revealedRef.current = false;
          onAction?.();
        }}>
        {actionLabel}
      </div>
      <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchCancel}
        style={{
          transform: `translateX(${offset}px)`,
          transition: swiping ? "none" : "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
          position:"relative", zIndex:1,
        }}>
        {children}
      </div>
    </div>
  );
}
