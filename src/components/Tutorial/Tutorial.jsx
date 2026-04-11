import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCardigan } from "../../context/CardiganContext";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { TutorialSpotlight } from "./TutorialSpotlight";
import { TutorialTooltip } from "./TutorialTooltip";
import { TutorialWelcome } from "./TutorialWelcome";
import { STEP_IDS_REQUIRING_FAB } from "./tutorialSteps";

// Viewport padding around the tooltip so it never hugs the edge.
const EDGE_PAD = 12;
// Delay between nav and spotlight measurement (matches screenSlide animation).
const NAV_SETTLE_MS = 340;

function computeTooltipStyle(rect, placement, tooltipEl) {
  // Center fallback: place tooltip in the middle of the viewport.
  if (!rect || placement === "center") {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tooltipH = tooltipEl?.offsetHeight ?? 180;
  const tooltipW = tooltipEl?.offsetWidth ?? Math.min(vw - 24, 320);

  // Auto-flip: if preferred placement doesn't fit, flip.
  let actual = placement;
  if (placement === "bottom" && rect.bottom + tooltipH + 16 > vh - EDGE_PAD) {
    actual = rect.top - tooltipH - 16 > EDGE_PAD ? "top" : "bottom";
  } else if (placement === "top" && rect.top - tooltipH - 16 < EDGE_PAD) {
    actual = rect.bottom + tooltipH + 16 < vh - EDGE_PAD ? "bottom" : "top";
  }

  let top;
  if (actual === "top") {
    top = rect.top - tooltipH - 14;
  } else {
    top = rect.bottom + 14;
  }
  top = Math.max(EDGE_PAD, Math.min(top, vh - tooltipH - EDGE_PAD));

  // Horizontally center on target, clamp to viewport.
  let left = rect.left + rect.width / 2 - tooltipW / 2;
  left = Math.max(EDGE_PAD, Math.min(left, vw - tooltipW - EDGE_PAD));

  return { top, left };
}

function intersects(rect, bubbleTop, bubbleLeft, bubbleH, bubbleW) {
  if (!rect) return false;
  return !(
    bubbleLeft + bubbleW < rect.left ||
    bubbleLeft > rect.right ||
    bubbleTop + bubbleH < rect.top ||
    bubbleTop > rect.bottom
  );
}

/**
 * Main tutorial orchestrator.
 * - Reads tutorial state + actions from CardiganContext.
 * - Navigates between screens as steps require.
 * - Measures target elements via getBoundingClientRect + ResizeObserver +
 *   scroll/resize/orientationchange listeners.
 * - Renders spotlight + tooltip (or welcome card) via a portal to document.body.
 */
export function Tutorial() {
  const {
    tutorial,
    navigate,
    screen,
    setHideFab,
    drawerOpen,
  } = useCardigan();
  const { t } = useT();

  const [rect, setRect] = useState(null);
  const [tooltipStyle, setTooltipStyle] = useState(null);
  const [centered, setCentered] = useState(false);
  const [ready, setReady] = useState(false);
  const tooltipRef = useRef(null);
  const retryRef = useRef(0);

  const step = tutorial?.step || null;
  const isActive = tutorial?.isActive;
  const isWelcome = tutorial?.isWelcome;

  // ── Navigate to the step's screen when needed ──
  useEffect(() => {
    if (!isActive || !step) return;
    if (step.screen && step.screen !== screen) {
      navigate(step.screen);
    }
  }, [isActive, step, screen, navigate]);

  // ── Hide FAB during the tour except on the FAB step ──
  useEffect(() => {
    if (!isActive || !step) return;
    const needFab = STEP_IDS_REQUIRING_FAB.has(step.id);
    setHideFab?.(!needFab);
    return () => setHideFab?.(false);
  }, [isActive, step, setHideFab]);

  // ── Measure target element ──
  const measure = useCallback(() => {
    if (!step) { setRect(null); return; }
    if (!step.selector) { setRect(null); setReady(true); return; }
    const el = document.querySelector(step.selector);
    if (!el) {
      // Retry a few times for elements that mount late after a screen switch.
      if (retryRef.current < 4) {
        retryRef.current += 1;
        setTimeout(measure, 150);
        return;
      }
      // Give up and auto-skip to the next step.
      if (typeof window !== "undefined" && window.console) {
        console.warn(`[Tutorial] Target not found for step "${step.id}": ${step.selector}`);
      }
      tutorial.next();
      return;
    }
    retryRef.current = 0;
    const r = el.getBoundingClientRect();
    setRect({
      top: r.top, left: r.left, right: r.right, bottom: r.bottom,
      width: r.width, height: r.height,
    });
    setReady(true);
  }, [step, tutorial]);

  // Initial measurement for each step — wait for screen transition to settle.
  useLayoutEffect(() => {
    if (!isActive || !step) { setReady(false); setRect(null); return; }
    setReady(false);
    retryRef.current = 0;
    const delay = step.screen && step.screen !== screen ? NAV_SETTLE_MS : 40;
    const timer = setTimeout(measure, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, step?.id]);

  // Re-measure on resize/scroll/orientation change, throttled via rAF.
  useEffect(() => {
    if (!isActive || !step || !step.selector) return;
    let raf = 0;
    const handler = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", handler);
    window.addEventListener("orientationchange", handler);
    window.addEventListener("scroll", handler, true);

    let observer;
    const el = document.querySelector(step.selector);
    if (el && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(handler);
      observer.observe(el);
      if (document.body) observer.observe(document.body);
    }

    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("orientationchange", handler);
      window.removeEventListener("scroll", handler, true);
      cancelAnimationFrame(raf);
      if (observer) observer.disconnect();
    };
  }, [isActive, step, measure]);

  // ── Compute tooltip position once rect + tooltip are available ──
  useLayoutEffect(() => {
    if (!isActive || !step) { setTooltipStyle(null); setCentered(false); return; }
    if (step.placement === "center" || !rect) {
      setCentered(true);
      setTooltipStyle(null);
      return;
    }
    const style = computeTooltipStyle(rect, step.placement, tooltipRef.current);
    // Narrow-screen fallback: if the tooltip would overlap the spotlight, center it.
    const vw = window.innerWidth;
    const bubbleW = tooltipRef.current?.offsetWidth ?? Math.min(vw - 24, 320);
    const bubbleH = tooltipRef.current?.offsetHeight ?? 180;
    if (
      typeof style.top === "number" &&
      typeof style.left === "number" &&
      intersects(rect, style.top, style.left, bubbleH, bubbleW)
    ) {
      setCentered(true);
      setTooltipStyle(null);
    } else {
      setCentered(false);
      setTooltipStyle(style);
    }
  }, [isActive, step, rect, ready]);

  // ── ESC to skip ──
  const onEscape = useCallback(() => {
    if (isActive) tutorial.skip();
    else if (isWelcome) tutorial.skip();
  }, [isActive, isWelcome, tutorial]);
  useEscape(isActive || isWelcome ? onEscape : null);

  // ── Pause while drawer is open ──
  const paused = isActive && !!drawerOpen;

  if (!tutorial) return null;

  // Welcome modal
  if (isWelcome) {
    return createPortal(
      <TutorialWelcome
        onAccept={() => tutorial.start()}
        onDecline={() => tutorial.skip()}
      />,
      document.body
    );
  }

  if (!isActive || !step || paused) return null;

  const title = t(step.titleKey);
  const body = t(step.bodyKey);

  return createPortal(
    <>
      <TutorialSpotlight rect={rect} padding={step.padding} />
      <div ref={tooltipRef}>
        <TutorialTooltip
          title={title}
          body={body}
          stepIndex={tutorial.stepIndex}
          totalSteps={tutorial.totalSteps}
          isFirst={tutorial.isFirst}
          isLast={tutorial.isLast}
          onPrev={tutorial.prev}
          onNext={tutorial.next}
          onSkip={tutorial.skip}
          style={tooltipStyle || { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
          centered={centered}
        />
      </div>
    </>,
    document.body
  );
}
