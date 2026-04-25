import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCardigan } from "../../context/CardiganContext";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { TutorialSpotlight } from "./TutorialSpotlight";
import { TutorialTooltip } from "./TutorialTooltip";
import { TutorialWelcome } from "./TutorialWelcome";
import { STEP_IDS_REQUIRING_FAB, STEP_IDS_WITH_DRAWER, TUTORIAL_STEPS } from "./tutorialSteps";

// Viewport padding around the tooltip so it never hugs the edge.
const EDGE_PAD = 12;
// Time for the drawer open/close animation to settle before measuring.
const DRAWER_SETTLE_MS = 800;
// Delay between nav and spotlight measurement (matches screenSlide animation).
const NAV_SETTLE_MS = 750;

function computeTooltipStyle(rect, placement, tooltipEl) {
  // Center fallback: place tooltip in the middle of the viewport.
  if (!rect || placement === "center") {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
  const vw = window.innerWidth;
  // Prefer visualViewport when available — on iOS Safari it gives the actual
  // visible area (excluding overlaying browser chrome), so the clamp below
  // keeps the tooltip clear of the bottom bar.
  const vh = (typeof window !== "undefined" && window.visualViewport?.height)
    || window.innerHeight;
  // Use `||` (not `??`) so a measured height/width of 0 falls back to defaults.
  const tooltipH = tooltipEl?.offsetHeight || 180;
  const tooltipW = tooltipEl?.offsetWidth || Math.min(vw - 24, 320);

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
 * - Navigates between screens and opens the drawer as steps require.
 * - Measures target elements via getBoundingClientRect + ResizeObserver +
 *   scroll/resize/orientationchange listeners.
 * - Renders spotlight + tooltip (or welcome card) via a portal to document.body.
 */
export function Tutorial() {
  const {
    tutorial,
    navigate,
    screen,
    drawerOpen,
    setDrawerOpen,
  } = useCardigan();
  const { t } = useT();

  const [rect, setRect] = useState(null);
  const [tooltipStyle, setTooltipStyle] = useState(null);
  const [centered, setCentered] = useState(false);
  const [ready, setReady] = useState(false);
  // True while the drawer is animating open/closed or the screen is
  // transitioning — suppresses spotlight/tooltip until settled.
  const [settling, setSettling] = useState(false);
  const tooltipRef = useRef(null);
  const retryRef = useRef(0);

  const step = tutorial?.step || null;
  const isActive = tutorial?.isActive;
  const isWelcome = tutorial?.isWelcome;
  const isDrawerStep = step && STEP_IDS_WITH_DRAWER.has(step.id);

  // Stable refs for values used in effects that shouldn't retrigger.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const setDrawerOpenRef = useRef(setDrawerOpen);
  setDrawerOpenRef.current = setDrawerOpen;
  const drawerOpenRef = useRef(drawerOpen);
  drawerOpenRef.current = drawerOpen;

  // ── Open/close drawer and navigate for each step ──
  //
  // Drawer steps:     open the drawer, wait for animation, then measure.
  // Non-drawer steps: close the drawer (if open), navigate to screen, wait, measure.
  useEffect(() => {
    if (!isActive || !step) { setSettling(false); return; }
    const timers = [];

    if (step.openDrawer) {
      // Drawer step: open the drawer and wait for it to settle.
      if (!drawerOpenRef.current) {
        setSettling(true);
        setDrawerOpenRef.current(true);
        timers.push(setTimeout(() => setSettling(false), DRAWER_SETTLE_MS));
      } else {
        setSettling(false);
      }
    } else {
      // Non-drawer step: close drawer if open, navigate if needed.
      const needsClose = drawerOpenRef.current;
      const needsNav = step.screen && step.screen !== screenRef.current;

      if (needsClose || needsNav) {
        setSettling(true);
        if (needsClose) setDrawerOpenRef.current(false);
        // Navigate after drawer closes (or immediately if drawer wasn't open).
        const navDelay = needsClose ? 500 : 0;
        if (needsNav) {
          timers.push(setTimeout(() => navigateRef.current(step.screen), navDelay));
        }
        // Wait for close + screen slide to settle.
        const totalDelay = navDelay + (needsNav ? NAV_SETTLE_MS : needsClose ? 500 : 0);
        timers.push(setTimeout(() => setSettling(false), totalDelay));
      } else {
        setSettling(false);
      }
    }

    return () => timers.forEach(clearTimeout);
    // `step?.id` is the canonical key for a tutorial step — including the
    // full `step` object would re-run the effect on parent re-renders
    // even when the user hasn't advanced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, step?.id]);

  // ── Boost FAB z-index above the tutorial overlay on the FAB step ──
  //
  // The FAB's visibility is driven upstream (App.jsx derives `hideFab`
  // from tutorial state directly), so here we only manage the z-index
  // boost class — no setState that would run on tutorial unmount and
  // cause a one-frame lag where the overlay is gone but BottomTabs
  // haven't remounted yet.
  useEffect(() => {
    if (!isActive || !step) return;
    const needFab = STEP_IDS_REQUIRING_FAB.has(step.id);
    if (needFab) document.body.classList.add("tut-fab-active");
    else document.body.classList.remove("tut-fab-active");
    return () => document.body.classList.remove("tut-fab-active");
  }, [isActive, step]);

  // ── Boost drawer z-index above tutorial overlay during drawer steps ──
  useEffect(() => {
    if (!isActive || !step) return;
    if (isDrawerStep) document.body.classList.add("tut-drawer-active");
    else document.body.classList.remove("tut-drawer-active");
    return () => document.body.classList.remove("tut-drawer-active");
  }, [isActive, step, isDrawerStep]);

  // ── Measure target element ──
  const measure = useCallback(() => {
    if (!step) { setRect(null); return; }
    if (!step.selector) { setRect(null); setReady(true); return; }
    const el = document.querySelector(step.selector);
    if (!el) {
      // Retry a few times for elements that mount late after a screen switch.
      if (retryRef.current < 6) {
        retryRef.current += 1;
        setTimeout(measure, 200);
        return;
      }
      // Give up and auto-skip to the next step.
      if (import.meta.env.DEV && typeof window !== "undefined" && window.console) {
        console.warn(`[Tutorial] Target not found for step "${step.id}": ${step.selector}`);
      }
      tutorial.next();
      return;
    }
    retryRef.current = 0;
    // Tag the matched element so CSS can highlight it. The drawer is
    // z-index-boosted above the tutorial dim during drawer steps, which
    // would otherwise leave every drawer-item at full brightness — the
    // user couldn't tell which one the tooltip was pointing at. We
    // strip the marker off the previous target before re-tagging.
    document.querySelectorAll(".tut-target").forEach(n => {
      if (n !== el) n.classList.remove("tut-target");
    });
    el.classList.add("tut-target");
    const r = el.getBoundingClientRect();
    setRect({
      top: r.top, left: r.left, right: r.right, bottom: r.bottom,
      width: r.width, height: r.height,
    });
    setReady(true);
  }, [step, tutorial]);

  // Initial measurement for each step — wait for settling to clear first.
  useLayoutEffect(() => {
    if (!isActive || !step) { setReady(false); setRect(null); return; }
    if (settling) { setReady(false); setRect(null); return; }
    setReady(false);
    retryRef.current = 0;
    const timer = setTimeout(measure, 60);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, step?.id, settling]);

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
    // `||` so a measured 0 (e.g. pre-mount) falls back to defaults.
    const bubbleW = tooltipRef.current?.offsetWidth || Math.min(vw - 24, 320);
    const bubbleH = tooltipRef.current?.offsetHeight || 180;
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

  // ── Pause while drawer is open — but NOT during drawer steps ──
  const paused = isActive && !!drawerOpen && !isDrawerStep;

  // ── Hard cleanup on unmount / finish ──
  useEffect(() => {
    if (isActive || isWelcome) return;
    // Close drawer if left open by a drawer step.
    if (drawerOpenRef.current) setDrawerOpenRef.current(false);
    // Defer one frame so React's own portal cleanup runs first.
    const raf = requestAnimationFrame(() => {
      document.querySelectorAll(".tut-dim, .tut-blocker, .tut-spotlight, .tut-nav-chip").forEach(el => el.remove());
      document.querySelectorAll(".tut-nav-pulse").forEach(el => el.classList.remove("tut-nav-pulse"));
      document.querySelectorAll(".tut-target").forEach(el => el.classList.remove("tut-target"));
      document.body.classList.remove("tut-drawer-active", "tut-fab-active");
    });
    return () => cancelAnimationFrame(raf);
  }, [isActive, isWelcome]);

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
  const bodyText = t(step.bodyKey);

  // On iOS (not already installed), append install instructions to the last step
  const showInstall = step.showInstall
    && /iPad|iPhone|iPod/.test(navigator.userAgent)
    && !(window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches);

  const body = showInstall ? (
    <>
      <div>{bodyText}</div>
      <div style={{ borderTop:"1px solid var(--border-lt)", marginTop:12, paddingTop:12 }}>
        <div style={{ fontSize:13, fontWeight:700, color:"var(--charcoal)", marginBottom:8 }}>{t("install.title")}</div>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
          <div style={{ width:20, height:20, borderRadius:"50%", background:"var(--teal-pale)", color:"var(--teal-dark)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, flexShrink:0 }}>1</div>
          <span style={{ fontSize:12, color:"var(--charcoal)" }}>
            {t("install.tapButton")}{" "}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign:"middle" }}>
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
            {" "}{t("install.safariButton")}
          </span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:20, height:20, borderRadius:"50%", background:"var(--teal-pale)", color:"var(--teal-dark)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, flexShrink:0 }}>2</div>
          <span style={{ fontSize:12, color:"var(--charcoal)" }}>
            {t("install.selectLabel")} <strong>"{t("install.selectAdd")}"</strong>
          </span>
        </div>
      </div>
    </>
  ) : bodyText;

  // While settling (drawer opening / screen switching), show a dim overlay.
  if (settling) {
    return createPortal(
      <div className="tut-dim tut-dim--transition" />,
      document.body
    );
  }

  return createPortal(
    <>
      <TutorialSpotlight rect={rect} padding={step.padding} />
      <TutorialTooltip
        key={step.id}
        ref={tooltipRef}
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
        placement={step.placement}
      />
    </>,
    document.body
  );
}
