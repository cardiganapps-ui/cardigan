import { useCallback, useEffect, useId, useRef, useState } from "react";
import { DRAWER_EDGE_BAND, isOwned, isOwnedBy, release, tryClaim } from "../hooks/swipeCoordinator";
import { claim as claimReveal, release as releaseReveal, closeOpen } from "../hooks/swipeRevealCoordinator";
import { haptic } from "../utils/haptics";

/* ── SwipeRevealRow ──
   iOS Mail-style swipe-left to reveal trailing action buttons.

   The wrapped row content sits in a `position: relative` frame; the
   action tray is absolutely positioned along the right edge and is
   visually clipped by the frame's `overflow: hidden`. As the user
   drags left, the foreground translates negatively and uncovers the
   tray underneath. Three release outcomes:

     1. dx <  peek (40% of trayWidth) → snap back to closed.
     2. dx ≥  peek but < commit       → settle to open (-trayWidth),
                                        showing the action tray.
     3. dx ≥  commit (70% of viewport)→ fire the FIRST action
                                        immediately and slide off.

   Gesture rules (matching CLAUDE.md / existing useSwipe conventions):
     - Ignore touches in the left-edge dead zone so the drawer's edge-
       swipe gets priority (DRAWER_EDGE_BAND from swipeCoordinator).
     - Only engage if |dx| > |dy| + ENGAGE_THRESHOLD (vertical-scroll
       respect — release the gesture immediately on vertical motion).
     - Claim swipeCoordinator at the moment of engagement; release on
       end/cancel/unmount.
     - Tap-anywhere on the foreground while open → snap closed (and
       cancel the onClick that would normally open the SessionSheet).
     - Only ONE row may be open at a time across the whole app
       (swipeRevealCoordinator). Opening row B closes row A.

   Props:
     actions:      [{ key, icon, label, color, onAction }] — rendered
                   right-to-left in the tray (first action = leftmost
                   when open, AND the one triggered by commit-swipe).
     children:     row content (kept onClick semantics — see safeClick
                   below).
     onClick:      forwarded to the foreground IF the row is closed.
                   When open, click closes the row instead.
     disabled:     skip the gesture entirely (e.g. read-only mode).
     className:    applied to the outer frame (so callers can hand-pin
                   the row-item / session-row classes the same as
                   before).
*/

const ENGAGE_THRESHOLD = 8;     // px before we commit to "this is a horizontal swipe"
const ACTION_WIDTH = 80;        // px per action button
const PEEK_RATIO = 0.4;         // drag past this fraction of trayWidth → settle open
const COMMIT_RATIO = 0.7;       // drag past this fraction of viewport → fire primary
const OWNER_ID = "swipe-reveal-row";

export function SwipeRevealRow({ actions = [], children, onClick, disabled = false, className = "" }) {
  const id = useId();
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const startRef = useRef(null);
  const engagedRef = useRef(false);
  const armedRef = useRef(false);
  const openRef = useRef(false);
  const wrapRef = useRef(null);

  const trayWidth = Math.max(actions.length, 1) * ACTION_WIDTH;
  const peekPx = trayWidth * PEEK_RATIO;

  useEffect(() => { openRef.current = open; }, [open]);

  const closeRow = useCallback(() => {
    setOpen(false);
    setDx(0);
    armedRef.current = false;
    releaseReveal(id);
  }, [id]);

  // Tap-outside / scroll-outside → close. Mounted only while open to
  // avoid the listener fan-out cost across many idle rows.
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e) => {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target)) return;
      closeRow();
    };
    document.addEventListener("touchstart", onDocPointer, { passive: true });
    document.addEventListener("mousedown", onDocPointer);
    return () => {
      document.removeEventListener("touchstart", onDocPointer);
      document.removeEventListener("mousedown", onDocPointer);
    };
  }, [open, closeRow]);

  // Release the global lock if we unmount mid-gesture.
  useEffect(() => () => {
    release(OWNER_ID);
    releaseReveal(id);
  }, [id]);

  const onTouchStart = useCallback((e) => {
    if (disabled) return;
    const t = e.touches[0];
    if (!t) return;
    // Left-edge dead zone — drawer claims gestures starting there.
    if (t.clientX < DRAWER_EDGE_BAND) return;
    // Another horizontal-swipe handler is mid-drag (Agenda day strip,
    // carousel) — don't compete.
    if (isOwned() && !isOwnedBy(OWNER_ID)) return;
    startRef.current = { x: t.clientX, y: t.clientY, baseDx: openRef.current ? -trayWidth : 0 };
    engagedRef.current = false;
  }, [disabled, trayWidth]);

  const onTouchMove = useCallback((e) => {
    if (!startRef.current) return;
    const t = e.touches[0];
    if (!t) return;
    const totalDx = t.clientX - startRef.current.x;
    const totalDy = t.clientY - startRef.current.y;
    if (!engagedRef.current) {
      // Engage on first decisive horizontal motion. If the user moves
      // mostly vertically, abandon — let the scroll container have it.
      if (Math.abs(totalDx) < ENGAGE_THRESHOLD) return;
      if (Math.abs(totalDy) > Math.abs(totalDx)) {
        startRef.current = null;
        return;
      }
      if (!tryClaim(OWNER_ID)) { startRef.current = null; return; }
      engagedRef.current = true;
      setDragging(true);
    }
    let next = startRef.current.baseDx + totalDx;
    // Resist past the tray width with a damped pull, so the gesture
    // tells the user "no more reveal beyond this".
    if (next < -trayWidth) {
      const overshoot = -trayWidth - next;
      next = -trayWidth - overshoot * 0.3;
    }
    // Forbid right-pull when closed — would expose empty leading edge.
    if (next > 0) next = 0;
    setDx(next);

    // Commit-arm: when the user has dragged most of the way across,
    // arm the primary action so release fires immediately. Haptic on
    // crossing the arm point both ways.
    const commitPx = (typeof window !== "undefined" ? window.innerWidth : 600) * COMMIT_RATIO;
    if (-next >= commitPx && !armedRef.current) {
      armedRef.current = true;
      haptic.tap?.();
    } else if (-next < commitPx && armedRef.current) {
      armedRef.current = false;
    }
  }, [trayWidth]);

  const onTouchEnd = useCallback(() => {
    if (!startRef.current) return;
    const finalDx = dx;
    startRef.current = null;
    setDragging(false);
    if (engagedRef.current) {
      engagedRef.current = false;
      release(OWNER_ID);
    }
    if (armedRef.current && actions[0]) {
      // Commit-swipe: fire primary action with a slide-off.
      armedRef.current = false;
      const vw = typeof window !== "undefined" ? window.innerWidth : 600;
      setDx(-vw);
      haptic.success?.();
      // Settle delay so the slide-off animates BEFORE the action
      // mutates state / removes the row.
      setTimeout(() => {
        try { actions[0].onAction?.(); } catch { /* swallow — UI already closed */ }
        // Most commit actions remove the row (delete / cancel) or
        // transition it to a new status (complete). If the row is
        // still mounted, snap it back to closed so it doesn't sit at
        // -vw offscreen.
        setDx(0);
        setOpen(false);
        releaseReveal(id);
      }, 220);
      return;
    }
    if (-finalDx >= peekPx) {
      setOpen(true);
      setDx(-trayWidth);
      claimReveal(id, () => { setOpen(false); setDx(0); });
    } else {
      setOpen(false);
      setDx(0);
      releaseReveal(id);
    }
  }, [dx, actions, peekPx, trayWidth, id]);

  const onTouchCancel = useCallback(() => {
    startRef.current = null;
    setDragging(false);
    if (engagedRef.current) {
      engagedRef.current = false;
      release(OWNER_ID);
    }
    // Snap to nearest stable state.
    if (open) { setDx(-trayWidth); } else { setDx(0); }
  }, [open, trayWidth]);

  // When closed, forward the foreground click to caller's onClick.
  // When open, swallow the click and close the row instead — exactly
  // matches iOS Mail: tapping the partially-uncovered row closes it.
  const safeClick = useCallback((e) => {
    if (open || dx !== 0) {
      e.stopPropagation();
      e.preventDefault();
      closeRow();
      // Also close any other open row across the app (idempotent).
      closeOpen();
      return;
    }
    onClick?.(e);
  }, [open, dx, onClick, closeRow]);

  const transformStyle = {
    transform: `translate3d(${dx}px, 0, 0)`,
    transition: dragging ? "none" : "transform 0.28s cubic-bezier(0.34, 1.4, 0.6, 1)",
    willChange: dragging ? "transform" : undefined,
  };

  // Tray visibility ramps with how far the row has been pulled, so a
  // tiny accidental pull doesn't pop colored buttons under the row.
  const trayProgress = Math.min(1, -dx / trayWidth);

  return (
    <div
      ref={wrapRef}
      className={`swipe-reveal ${className}`}
      style={{ position: "relative", overflow: "hidden", touchAction: "pan-y" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}>
      {actions.length > 0 && (
        <div
          className="swipe-reveal-tray"
          aria-hidden={!open}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            opacity: trayProgress,
            pointerEvents: open ? "auto" : "none",
            transition: dragging ? "none" : "opacity 0.2s var(--ease-out)",
          }}>
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeRow();
                // Let the close settle visually before mutating. The
                // commit-swipe path on the same component already
                // try/catches the action; mirror that here so a
                // synchronous throw doesn't escape the setTimeout
                // boundary (which would otherwise hit window.onerror
                // unhandled — the UI is already closed by that
                // point).
                setTimeout(() => {
                  try { a.onAction?.(); } catch { /* swallow */ }
                }, 80);
              }}
              className="swipe-reveal-action btn-tap"
              style={{
                width: ACTION_WIDTH,
                background: a.color || "var(--charcoal-lt)",
                color: "white",
                border: "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                fontFamily: "var(--font-d)",
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: "0.02em",
                cursor: "pointer",
                padding: 0,
              }}
              aria-label={a.label}>
              {a.icon}
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
      <div onClick={safeClick} style={transformStyle}>
        {children}
      </div>
    </div>
  );
}
