import { useState, useCallback, useRef, useEffect } from "react";
import { haptic } from "../utils/haptics";
import { IconTrash } from "./Icons";
import { tryClaim as trySwipeClaim, release as releaseSwipe } from "../hooks/swipeCoordinator";

const ROW_OWNER_ID = "swipeable-row";

/* ── Swipeable row ──
   Reveals an action slot to the right of the content when the user
   swipes left. Tapping the revealed action plays a collapse-out
   animation then fires onAction. Originally lived inline in
   Notes.jsx; pulled out so session / payment lists reuse the same
   idiom. Matches Apple Mail / Notes convention.

   Usage:
     <SwipeableRow onAction={...} actionLabel="Eliminar" actionTone="danger">
       <div className="row-item">...</div>
     </SwipeableRow> */

const REVEAL_PX = -84;            // resting position when action is revealed
const ACTIVATE_PX = -42;          // swipe distance that latches the reveal
const RESISTANCE_LIMIT_PX = -116; // furthest the row can be dragged past reveal
const HINT_PEEK_PX = -36;
const HINT_STORAGE_KEY = "cardigan.swipe.hint.shown";

/* Module-level guard so only the FIRST SwipeableRow mounted in a
   session triggers the discoverability peek. localStorage flag is
   the durable record; the in-memory bool covers private mode. */
let hintShownThisSession = false;

const TONE_BG = {
  danger: "var(--red)",
  success: "var(--green)",
  warn: "var(--amber)",
};

/* exitOnAction (default true): tapping the revealed action plays the
   collapse-out animation then fires onAction — correct when onAction
   deletes the row (it's leaving the list anyway). Pass false when the
   action instead reveals an inline confirm step (e.g. expenses): the
   row must stay in place, so we just snap shut and fire onAction without
   the exit animation. */
export function SwipeableRow({ children, onAction, actionLabel, actionTone = "danger", exitOnAction = true }) {
  const ref = useRef(null);
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const [swiping, setSwiping] = useState(false);
  const [exiting, setExiting] = useState(false);
  // Measured height pinned in state (not a ref) — React Compiler
  // refuses ref reads during render, and the JSX below needs the
  // value to set the height inline for the collapse transition.
  const [pinnedHeight, setPinnedHeight] = useState(0);
  const revealedRef = useRef(false);
  const rootElRef = useRef(null);

  // Keep ref in sync so touch handlers see the latest committed offset
  // without re-binding on every render.
  useEffect(() => { offsetRef.current = offset; }, [offset]);

  /* Discoverability peek. First SwipeableRow rendered for a user who
     hasn't seen the hint plays a subtle peek-and-snap-back ~700ms
     after mount: the row shifts left ~36px (just enough to surface
     the action) then springs back via the transform transition.
     Persists in localStorage so it never repeats. */
  useEffect(() => {
    if (hintShownThisSession) return;
    let alreadyShown = false;
    try { alreadyShown = localStorage.getItem(HINT_STORAGE_KEY) === "1"; }
    catch { /* private mode */ }
    if (alreadyShown) { hintShownThisSession = true; return; }
    hintShownThisSession = true;
    try { localStorage.setItem(HINT_STORAGE_KEY, "1"); } catch { /* ignore */ }
    const peekIn  = setTimeout(() => setOffset(HINT_PEEK_PX), 700);
    const peekOut = setTimeout(() => setOffset(0), 1300);
    return () => { clearTimeout(peekIn); clearTimeout(peekOut); };
  }, []);

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
        if (!trySwipeClaim(ROW_OWNER_ID)) { ref.current = null; return; }
        ref.current.active = true;
        setSwiping(true);
      } else if (Math.abs(dy) > 8 || (!revealed && dx > 5)) {
        ref.current = null;
        return;
      } else return;
    }
    if (ref.current.active) {
      const raw = ref.current.startOffset + dx;
      // Rubber-band past REVEAL_PX: every extra px of pull only moves
      // the row half a px, with a hard floor at RESISTANCE_LIMIT_PX.
      // Gives the iOS-native "this is as far as it goes" feel without
      // a sudden hard stop.
      let next;
      if (raw >= 0) {
        next = 0;
      } else if (raw >= REVEAL_PX) {
        next = raw;
      } else {
        const over = REVEAL_PX - raw; // positive
        const damped = over * 0.5;
        next = Math.max(RESISTANCE_LIMIT_PX, REVEAL_PX - damped);
      }
      setOffset(next);
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

  const onTouchCancel = useCallback(() => {
    ref.current = null;
    setSwiping(false);
    releaseSwipe(ROW_OWNER_ID);
  }, []);

  const handleActionFocus = useCallback(() => {
    setOffset(REVEAL_PX);
    revealedRef.current = true;
  }, []);
  const handleActionBlur = useCallback(() => {
    setOffset(0);
    revealedRef.current = false;
  }, []);
  const handleActionKey = useCallback((e) => {
    if (e.key === "Escape") {
      setOffset(0);
      revealedRef.current = false;
      e.currentTarget.blur();
    }
  }, []);

  // Pre-deletion exit animation. The row collapses height → 0 and
  // fades opacity → 0 over 220ms before onAction fires. Without
  // this, the deleted row vanished instantly and the list above
  // jumped up, which read as jarring.
  const playExitThenAction = useCallback(() => {
    const el = rootElRef.current;
    if (!el) { onAction?.(); return; }
    // Pin the current height, THEN flip the exiting flag on the next
    // frame so React commits the explicit pixel value before the
    // transition starts. Without the rAF gap the height jumps from
    // "auto" straight to 0 with no animation frame.
    setPinnedHeight(el.getBoundingClientRect().height);
    requestAnimationFrame(() => {
      setExiting(true);
      setTimeout(() => { onAction?.(); }, 240);
    });
  }, [onAction]);

  const background = TONE_BG[actionTone] || TONE_BG.danger;

  // Activation threshold visual feedback: once the swipe has crossed
  // ACTIVATE_PX the action chip subtly grows + the label fades in.
  // Pre-activation the icon is on its own (compact peek); post-
  // activation it gets the label too.
  const activated = offset < ACTIVATE_PX;

  return (
    <div
      ref={rootElRef}
      data-swipeable-row
      style={{
        position: "relative",
        // overflow: hidden hides the action button when the row is
        // at rest (button sits behind the sliding content with
        // z-index:1). NO border-radius on the wrapper itself —
        // the inner .note-card-row owns its own rounding + 1px
        // border, and stacking two rounded clips with subtly
        // different metrics (one 3px border-left, the other a
        // plain box) left a hairline artifact on the inner's left
        // edge that read as "border cut off".
        overflow: "hidden",
        // Exit animation: collapse height + fade. pinnedHeight gets
        // set to the measured row height ONE frame before exiting
        // flips, so the transition has a real px value to interpolate
        // from (height: auto → 0 doesn't tween).
        height: exiting ? 0 : (pinnedHeight ? `${pinnedHeight}px` : "auto"),
        opacity: exiting ? 0 : 1,
        marginBottom: exiting ? 0 : undefined,
        transition: exiting
          ? "height 240ms var(--ease-out), opacity 220ms var(--ease-out), margin 240ms var(--ease-out)"
          : undefined,
      }}
    >
      <button
        type="button"
        aria-label={actionLabel}
        data-swipeable-action
        onFocus={handleActionFocus}
        onBlur={handleActionBlur}
        onKeyDown={handleActionKey}
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0, width: 84,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 4,
          background, color: "var(--white)",
          fontSize: "var(--text-xs)", fontWeight: 700, cursor: "pointer",
          // Square left edge (against the row), match container radius
          // on the right so the corner reads as part of the row.
          borderRadius: "0 var(--radius) var(--radius) 0",
          border: "none", padding: 0,
          fontFamily: "var(--font)",
          // Subtle inner press feel on the icon when the swipe is
          // committed enough to delete on release.
          transform: activated ? "scale(1)" : "scale(0.94)",
          opacity: activated ? 1 : 0.85,
          transition: "transform var(--dur-base) var(--ease-spring-soft), opacity var(--dur-base) var(--ease-out)",
          WebkitTapHighlightColor: "transparent",
        }}
        onClick={(e) => {
          // Keyboard-only courtesy: when the user activates via
          // Enter/Space (e.detail === 0), focus would otherwise leak
          // to <body> when this row unmounts. Walk to the next
          // SwipeableRow action button in the same list.
          const isKeyboardActivation = e.detail === 0;
          let nextFocus = null;
          if (isKeyboardActivation) {
            const currentRow = e.currentTarget.closest("[data-swipeable-row]");
            if (currentRow) {
              let parent = currentRow.parentElement;
              while (parent && !nextFocus) {
                const siblings = parent.querySelectorAll(
                  "[data-swipeable-row] [data-swipeable-action]",
                );
                for (const btn of siblings) {
                  if (btn !== e.currentTarget) { nextFocus = btn; break; }
                }
                parent = parent.parentElement;
              }
            }
          }
          setOffset(0);
          revealedRef.current = false;
          if (exitOnAction) playExitThenAction();
          else onAction?.();
          if (nextFocus) {
            requestAnimationFrame(() => {
              try { nextFocus.focus(); } catch { /* node may have unmounted too */ }
            });
          }
        }}>
        <IconTrash size={16} />
        <span style={{ fontSize: 11, lineHeight: 1 }}>{actionLabel}</span>
      </button>
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        style={{
          // ease-spring-soft (1.3 overshoot) reads as a gentle settle
          // rather than the prior 1.56 overshoot which felt bouncy.
          // 280ms is the sweet spot for snap-back: fast enough to feel
          // responsive, slow enough to read as motion (vs. a snap).
          transform: `translateX(${offset}px)`,
          transition: swiping ? "none" : "transform 280ms var(--ease-spring-soft)",
          position: "relative", zIndex: 1,
          willChange: swiping ? "transform" : "auto",
        }}>
        {children}
      </div>
    </div>
  );
}
