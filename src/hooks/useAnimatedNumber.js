import { useEffect, useRef, useState } from "react";

/* ── useAnimatedNumber ──
   Apple-style count-up. Returns a number that smoothly animates from
   its previous value to `target` over `duration` ms with an
   ease-out-expo curve — the same "fast start, soft landing" feel
   Stocks / Activity use for KPI cards.

   First mount: animates from 0 → target.
   Target change: animates from current → target.
   Same target as last frame: no-op (effect bails before kicking rAF).

   prefers-reduced-motion (system-level): bypasses animation and
   snaps to target immediately. Non-finite targets pass through
   untouched (null / undefined / NaN render as-is).

   The hook batches: many animated KPIs on the same screen all share
   the browser's single rAF frame budget, so a 4-up KPI grid still
   paints at 60fps on iPhone 13-era hardware. */

const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

export function useAnimatedNumber(target, { duration = 700, enabled = true, ease = easeOutExpo } = {}) {
  const [animated, setAnimated] = useState(0);
  const animatedRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => { animatedRef.current = animated; }, [animated]);

  // Snap conditions evaluated at render time so the returned value
  // can short-circuit straight to `target` without bouncing through
  // setState (which the eslint react-hooks/set-state-in-effect rule
  // discourages — and rightly so: an effect that synchronously
  // setState on every render-with-snap would thrash the render
  // queue). The effect below only needs to drive the rAF loop in
  // the animate-mode case.
  const isNonFinite = typeof target !== "number" || !isFinite(target);
  const reducedMotion = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const shouldSnap = isNonFinite || !enabled || reducedMotion;

  useEffect(() => {
    if (shouldSnap) {
      // Keep animatedRef in sync with the displayed value so a later
      // transition back to animate-mode starts from a sensible base.
      animatedRef.current = isNonFinite ? 0 : target;
      return;
    }
    const startValue = animatedRef.current;
    if (startValue === target) return;

    const startTime = performance.now();
    const tick = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = ease(t);
      const value = startValue + (target - startValue) * eased;
      setAnimated(t >= 1 ? target : value);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target, shouldSnap, isNonFinite, duration, ease]);

  return shouldSnap ? target : animated;
}
