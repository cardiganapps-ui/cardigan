import { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../i18n/index";
import { IconCheck, IconX } from "./Icons";
import { haptic } from "../utils/haptics";

/* Inline alert glyph for warning + error toasts. Stroke-2 to match
   the rest of the icon family. */
function GlyphAlert({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 9v4" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  );
}

export function Toast({ message, type = "error", duration, onDismiss, onRetry, actionLabel, persistent = false, stackIndex = 0 }) {
  const { t } = useT();
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Uniform short fade across every type. 1.4s still felt long when
  // toasts stacked (you'd dismiss one and the next was still there
  // half a beat too long), so the default is 900ms now. Plus the
  // 180ms fade-out below = ~1080ms of visible time — long enough to
  // read a short Spanish phrase, short enough to feel snappy.
  //
  // Error toasts that need persistence (mutationError with a
  // Reintentar) opt in via `persistent`. Undo toasts pass their
  // own UNDO_MS duration so the 5s window stays intact.
  const effectiveDuration = duration ?? 900;

  // Flip visibility synchronously when the message prop changes —
  // adjust-state-during-render so the toast enters/exits without a
  // set-state-in-effect cascade. The auto-dismiss timer stays in an
  // effect (legitimate async side-effect).
  //
  // prevMessage initializes to null (NOT message) so the first render
  // with a non-null message triggers the visibility flip. Initializing
  // to message would leave them equal on mount, the condition would
  // never fire, and visible would stay false forever — Toast would
  // render null on every mount. (Repro: render a fresh <Toast /> with
  // a unique key; without the null seed, no aria-live region appears.)
  const [prevMessage, setPrevMessage] = useState(null);
  if (message !== prevMessage) {
    setPrevMessage(message);
    if (message) { setVisible(true); setLeaving(false); }
    else { setVisible(false); }
  }
  // Dismiss animation runs for DISMISS_MS — the matching JS unmount
  // timer must hit AFTER the keyframe finishes (otherwise the DOM
  // node vanishes mid-fade and the toast pops out). Keep these
  // two in lockstep with the toastOut keyframe duration in base.css.
  const DISMISS_MS = 560;
  useEffect(() => {
    if (!message || persistent) return;
    const timer = setTimeout(() => {
      setLeaving(true);
      setTimeout(() => { setVisible(false); onDismiss?.(); }, DISMISS_MS);
    }, effectiveDuration);
    return () => clearTimeout(timer);
  }, [message, effectiveDuration, onDismiss, persistent]);

  if (!visible || !message) return null;

  // Toast type is conveyed by:
  //   • A 4px tinted stripe on the leading edge of the glass panel.
  //   • The icon chip's accent color.
  //   • Screen-reader role/liveness (above).
  // Text stays charcoal-on-glass for legibility — the previous
  // white-on-color chrome was punchy but felt heavy next to the new
  // Liquid Glass tab bar / topbar.
  const dismiss = () => { setLeaving(true); setTimeout(() => { setVisible(false); onDismiss?.(); }, DISMISS_MS); };

  // Type-specific icon — the message text alone left the toast feeling
  // homogeneous regardless of severity. A success toast and an error
  // toast are different kinds of message and the icon makes that
  // glanceable from the corner of the eye.
  const Icon = type === "success" ? IconCheck
    : type === "warning" || type === "error" ? GlyphAlert
    : null;

  // Stacking offset: each subsequent toast is ~58px further down, with
  // a slight scale fade so older entries recede visually rather than
  // fighting the newer one for attention.
  const top = `calc(var(--sat, 44px) + 52px + ${stackIndex * 58}px)`;
  const opacity = stackIndex === 0 ? 1 : Math.max(0.75, 1 - stackIndex * 0.1);
  const scale = stackIndex === 0 ? 1 : Math.max(0.94, 1 - stackIndex * 0.03);

  // Screen-reader semantics: errors and warnings are "interrupt" toasts
  // (role=alert, aria-live=assertive) so AT users hear them as soon as
  // they appear. Success / info / generic toasts are "polite" — they
  // queue behind the user's current speech. The visual class still
  // drives the actual chrome.
  const isInterrupt = type === "error" || type === "warning";
  const liveRole = isInterrupt ? "alert" : "status";
  const liveness = isInterrupt ? "assertive" : "polite";

  // Swipe-up-to-dismiss bypasses the toastOut keyframe path. The
  // gesture already slides the toast off-screen with its own inline
  // transform animation; calling `dismiss()` would set leaving=true
  // and re-trigger the toastOut keyframe starting from translateY(0),
  // visibly snapping the toast back to its slot before fading out.
  // `forceRemove` skips the leaving step and just yanks it from the
  // tree once the inline slide finishes.
  const forceRemove = () => { setVisible(false); onDismiss?.(); };

  return (
    <SwipeDismissToast
      scale={scale}
      opacity={opacity}
      top={top}
      leaving={leaving}
      onSwipeRemove={forceRemove}
      liveRole={liveRole}
      liveness={liveness}>
      <div className={`toast-panel toast-panel--${type}`} data-type={type}>
        {Icon && (
          <span className="toast-icon" aria-hidden>
            <Icon size={14} />
          </span>
        )}
        <span role="button" tabIndex={0} onClick={dismiss}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); dismiss(); } }}
          aria-label={t("close")}
          className="toast-message">{message}</span>
        {onRetry && (
          <button onClick={(e) => { e.stopPropagation(); onRetry(); dismiss(); }}
            className="toast-action">
            {actionLabel || t("retry")}
          </button>
        )}
        {/* Explicit dismiss button — the click-anywhere-to-dismiss was
            non-discoverable and persistent toasts had no obvious exit. */}
        {!onRetry && (
          <button onClick={(e) => { e.stopPropagation(); dismiss(); }}
            aria-label={t("close")}
            className="toast-close">
            <IconX size={14} />
          </button>
        )}
      </div>
    </SwipeDismissToast>
  );
}

/* ── SwipeDismissToast ──
   The outer wrapper that owns the toast's positioning, entrance/exit
   animation, AND a swipe-up-to-dismiss gesture. Extracted as its own
   component so the gesture refs + direct DOM mutation (used to keep
   60fps during the drag) don't bloat the Toast render path.

   Gesture rules:
     - Engage only after the finger moves ≥ 6px vertically — small
       wiggles during a tap don't activate.
     - Upward motion follows the finger 1:1. Downward motion is
       damped at 0.3× so the toast resists going "down past its slot"
       without feeling locked.
     - Release past 50px upward → dismiss (with a tap haptic).
     - Release under threshold → springy snap back with --ease-spring,
       same curve the bottom sheet uses for its settle.
     - While dragging, the entrance/exit CSS animation and the
       stack-promotion transition are suspended — the finger is the
       source of truth for position. Restored on release. */
function SwipeDismissToast({ scale, opacity, top, leaving, onSwipeRemove, liveRole, liveness, children }) {
  const wrapperRef = useRef(null);
  const dragRef = useRef({ startY: 0, dy: 0, dragging: false });

  const SETTLE = "transform 0.32s cubic-bezier(0.34, 1.4, 0.6, 1)";
  const STACK_TRANSITION = "top var(--dur-slow) var(--ease-spring), transform var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-out)";
  const SLIDE_OUT_MS = 240;

  const restingTransform = `scale(${scale})`;

  // touchstart only records the starting position. We deliberately do
  // NOT kill the entrance/exit animation here, because the gesture
  // may turn out to be a tap (no drag) and killing the animation
  // would visibly clobber the in-flight entrance. The kill happens
  // in onTouchMove once we've crossed the engagement threshold and
  // know the user is actually dragging.
  const onTouchStart = useCallback((e) => {
    const el = wrapperRef.current;
    if (!el || leaving) return;
    const t = e.touches[0];
    if (!t) return;
    dragRef.current = { startY: t.clientY, dy: 0, dragging: false };
  }, [leaving]);

  const onTouchMove = useCallback((e) => {
    const el = wrapperRef.current;
    if (!el) return;
    const t = e.touches[0];
    if (!t) return;
    const dy = t.clientY - dragRef.current.startY;
    if (!dragRef.current.dragging) {
      if (Math.abs(dy) < 6) return;
      // Engaged — NOW kill the entrance/stack transitions and let
      // our inline transform drive position 1:1 with the finger.
      dragRef.current.dragging = true;
      el.style.animation = "none";
      el.style.transition = "none";
    }
    // Upward freely; downward dampened to 30% so the toast feels
    // grounded but not locked.
    const clamped = dy < 0 ? dy : dy * 0.3;
    dragRef.current.dy = clamped;
    el.style.transform = `scale(${scale}) translateY(${clamped}px)`;
  }, [scale]);

  const onTouchEnd = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const { dy, dragging } = dragRef.current;
    dragRef.current.dragging = false;
    if (!dragging) {
      // It was a tap (or below the engage threshold). We never killed
      // the entrance animation, so there's nothing to restore.
      return;
    }
    if (dy < -50) {
      haptic.tap?.();
      // Slide out the rest of the way + fade. The setTimeout fires
      // onSwipeRemove which yanks the toast from the parent's stack
      // WITHOUT going through internal dismiss() — that would set
      // leaving=true and re-trigger the toastOut keyframe starting
      // from translateY(0), visibly snapping the toast back to its
      // slot before fading out.
      el.style.transition = `transform ${SLIDE_OUT_MS}ms cubic-bezier(0.4, 0, 1, 1), opacity ${SLIDE_OUT_MS}ms ease`;
      el.style.transform = `scale(${scale}) translateY(-${Math.abs(dy) + 60}px)`;
      el.style.opacity = "0";
      // Match the transition duration exactly so the unmount fires
      // as the slide completes — not mid-flight. +20ms buffer for
      // browser repaint quirks.
      setTimeout(onSwipeRemove, SLIDE_OUT_MS + 20);
      return;
    }
    // Below threshold — springy snap back to rest.
    el.style.transition = SETTLE;
    el.style.transform = restingTransform;
    setTimeout(() => {
      if (wrapperRef.current === el) {
        el.style.transition = STACK_TRANSITION;
        // Clear the animation override too so any subsequent
        // re-render (e.g. parent's setLeaving) can re-apply via
        // React's style prop.
        el.style.animation = "";
      }
    }, 340);
  }, [scale, restingTransform, STACK_TRANSITION, onSwipeRemove]);

  const onTouchCancel = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (!dragRef.current.dragging) {
      dragRef.current = { startY: 0, dy: 0, dragging: false };
      return;
    }
    dragRef.current.dragging = false;
    el.style.transition = SETTLE;
    el.style.transform = restingTransform;
    setTimeout(() => {
      if (wrapperRef.current === el) {
        el.style.transition = STACK_TRANSITION;
        el.style.animation = "";
      }
    }, 340);
  }, [restingTransform, SETTLE, STACK_TRANSITION]);

  return (
    <div
      ref={wrapperRef}
      role={liveRole}
      aria-live={liveness}
      aria-atomic="true"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      style={{
        position: "fixed", top, left: 12, right: 12,
        zIndex: "var(--z-install)", pointerEvents: "auto",
        animation: leaving
          ? "toastOut 560ms var(--ease-in-out) forwards"
          : "toastIn var(--dur-slower) var(--ease-spring)",
        opacity,
        transform: restingTransform,
        transformOrigin: "top center",
        touchAction: "pan-x", // allow horizontal page scroll, hijack vertical
        transition: STACK_TRANSITION,
      }}>
      {children}
    </div>
  );
}

/**
 * ToastStack — renders up to `max` toasts as a vertical stack,
 * newest at index 0 (top) and older entries offset below with a
 * subtle opacity + scale decay. Each entry auto-dismisses unless
 * marked persistent; clicking dismisses immediately.
 */
export function ToastStack({ toasts, onDismiss, max = 3 }) {
  const visible = toasts.slice(-max);
  // Reverse so the newest entry sits at the top (stackIndex 0).
  const reversed = [...visible].reverse();
  return reversed.map((toast, i) => (
    <Toast
      key={toast.id}
      stackIndex={i}
      message={toast.message}
      type={toast.kind}
      persistent={toast.persistent}
      duration={toast.duration}
      onDismiss={() => onDismiss(toast.id)}
      onRetry={toast.onRetry}
      actionLabel={toast.actionLabel}
    />
  ));
}
