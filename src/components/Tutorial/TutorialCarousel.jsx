import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/index";
import { haptic } from "../../utils/haptics";
import {
  IconBarChart,
  IconCalendar,
  IconCheck,
  IconLink,
  IconSparkle,
  IconUsers,
} from "../Icons";
import { LogoIcon } from "../LogoMark";
import { TUTORIAL_SLIDES } from "./tutorialSlides";

// ── Hero icon registry ──
// One soft teal-tinted badge per slide. Adding a slide icon = one case.
function HeroIcon({ name }) {
  const size = 30;
  switch (name) {
    case "logo":     return <LogoIcon size={size} color="currentColor" />;
    case "calendar": return <IconCalendar size={size} />;
    case "users":    return <IconUsers size={size} />;
    case "link":     return <IconLink size={size} />;
    case "barChart": return <IconBarChart size={size} />;
    case "sparkle":  return <IconSparkle size={size} />;
    case "check":    return <IconCheck size={size} />;
    default:         return <LogoIcon size={size} color="currentColor" />;
  }
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Self-contained swipeable onboarding carousel.
 *
 * Paging is native CSS scroll-snap (`scroll-snap-type: x mandatory`) so iOS
 * Safari owns the momentum + rubber-band physics — there's no JS touch
 * handling fighting the browser, and nothing is measured against the live
 * DOM. The component only reads `scrollLeft` to keep the dot pager + button
 * labels in sync.
 */
export function TutorialCarousel({ onSkip, onFinish }) {
  const { t } = useT();
  const trackRef = useRef(null);
  const [current, setCurrent] = useState(0);
  const currentRef = useRef(0);
  useEffect(() => { currentRef.current = current; }, [current]);
  const total = TUTORIAL_SLIDES.length;
  const isLast = current === total - 1;

  // Keep `current` in sync with the snapped slide. rAF-debounced so a
  // momentum scroll doesn't thrash setState on every frame.
  const rafRef = useRef(0);
  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = trackRef.current;
      if (!el || !el.clientWidth) return;
      const idx = Math.round(el.scrollLeft / el.clientWidth);
      if (idx !== currentRef.current && idx >= 0 && idx < total) {
        haptic.tap();
        setCurrent(idx);
      }
    });
  }, [total]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const scrollTo = useCallback((idx) => {
    const el = trackRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(idx, total - 1));
    el.scrollTo({
      left: clamped * el.clientWidth,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [total]);

  const handleNext = useCallback(() => {
    if (isLast) {
      haptic.success();
      onFinish();
    } else {
      scrollTo(current + 1);
    }
  }, [isLast, current, scrollTo, onFinish]);

  const handleBack = useCallback(() => scrollTo(current - 1), [current, scrollTo]);

  return (
    <div
      className="tut-carousel-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tut-carousel-title"
    >
      <div className="tut-carousel-card">
        <button
          type="button"
          className="tut-carousel-skip"
          onClick={onSkip}
          aria-label={t("tutorial.skipAria")}
        >
          {t("tutorial.skip")}
        </button>

        <div
          className="tut-carousel-track scroll-bounce"
          ref={trackRef}
          onScroll={onScroll}
        >
          {TUTORIAL_SLIDES.map((slide, i) => (
            <div
              className="tut-carousel-slide"
              key={slide.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} / ${total}`}
              aria-hidden={i !== current}
            >
              <div className="tut-carousel-hero" aria-hidden="true">
                <HeroIcon name={slide.icon} />
              </div>
              <div
                className="tut-carousel-title"
                id={i === current ? "tut-carousel-title" : undefined}
              >
                {t(slide.titleKey)}
              </div>
              <div className="tut-carousel-body">{t(slide.bodyKey)}</div>
            </div>
          ))}
        </div>

        <div
          className="tut-carousel-dots"
          role="tablist"
          aria-label={`${current + 1} / ${total}`}
        >
          {TUTORIAL_SLIDES.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              className={`tut-carousel-dot${i === current ? " tut-carousel-dot--active" : ""}`}
              aria-label={t("tutorial.goToStep", { n: i + 1 })}
              aria-current={i === current ? "true" : undefined}
              onClick={() => scrollTo(i)}
            />
          ))}
        </div>

        <div className="tut-carousel-actions">
          {current > 0 ? (
            <button type="button" className="tut-btn tut-btn-ghost" onClick={handleBack}>
              {t("tutorial.prev")}
            </button>
          ) : <span />}
          <button type="button" className="tut-btn tut-btn-primary" onClick={handleNext}>
            {isLast ? t("tutorial.begin") : t("tutorial.next")}
          </button>
        </div>
      </div>
    </div>
  );
}
