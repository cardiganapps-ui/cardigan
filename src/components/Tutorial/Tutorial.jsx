import { createPortal } from "react-dom";
import { useCardigan } from "../../context/CardiganContext";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { LogoIcon } from "../LogoMark";
import { TutorialCarousel } from "./TutorialCarousel";

// ── Welcome gate ──
// Asks consent before launching the carousel, so a brand-new user isn't
// dumped straight into a 6-slide tour. "Ahora no" is the cheap escape that
// marks the tutorial done. Bypassed on Settings replay (reset() goes
// straight to the running state).
function TutorialWelcome({ onAccept, onDecline }) {
  const { t } = useT();
  const trapRef = useFocusTrap(true);
  return (
    <div
      className="tut-carousel-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tut-welcome-title"
      ref={trapRef}
    >
      <div className="tut-carousel-card tut-carousel-card--welcome">
        <div className="tut-carousel-hero" aria-hidden="true">
          <LogoIcon size={30} color="currentColor" />
        </div>
        <div id="tut-welcome-title" className="tut-carousel-title">
          {t("tutorial.welcomeTitle")}
        </div>
        <div className="tut-carousel-body">{t("tutorial.welcomeBody")}</div>
        <div className="tut-carousel-actions tut-carousel-actions--stack">
          <button type="button" className="tut-btn tut-btn-primary" onClick={onAccept}>
            {t("tutorial.welcomeYes")}
          </button>
          <button type="button" className="tut-btn tut-btn-ghost" onClick={onDecline}>
            {t("tutorial.welcomeNo")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Tutorial entry point.
 *
 * A thin shell over the carousel — it reads tutorial state from context,
 * portals to document.body, and wires Escape-to-skip. There is no DOM
 * measurement, screen navigation, or z-index juggling here anymore; the
 * carousel is fully self-contained.
 */
export function Tutorial() {
  const { tutorial } = useCardigan();
  const isWelcome = tutorial?.isWelcome;
  const isActive = tutorial?.isActive;

  useEscape(isWelcome || isActive ? tutorial.skip : null);

  if (!tutorial || (!isWelcome && !isActive)) return null;

  if (isWelcome) {
    return createPortal(
      <TutorialWelcome onAccept={tutorial.start} onDecline={tutorial.skip} />,
      document.body
    );
  }

  return createPortal(
    <CarouselWithTrap onSkip={tutorial.skip} onFinish={tutorial.finish} />,
    document.body
  );
}

// Focus trap lives on a wrapper so the carousel component itself stays a
// pure presentational pager.
function CarouselWithTrap({ onSkip, onFinish }) {
  const trapRef = useFocusTrap(true);
  return (
    <div ref={trapRef}>
      <TutorialCarousel onSkip={onSkip} onFinish={onFinish} />
    </div>
  );
}
