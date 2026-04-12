import { forwardRef } from "react";
import { useT } from "../../i18n/index";

// Tooltip bubble with title, body, progress indicator and action buttons.
// Positioning is handled by the orchestrator via the `style` prop; this
// component only renders content and fires callbacks.
//
// Layout:
//   ┌──────────────────────────────┐
//   │  Title                    ×  │  ← skip is an icon button, top-right
//   │  Body text                   │
//   │                              │
//   │  ● ● ○ ○ ○ ○ ○ ○             │  ← dot progress (replaces "Paso X de Y")
//   │  [ Atrás ]       [ Siguiente]│  ← navigation row
//   └──────────────────────────────┘
//
// Uses forwardRef so the orchestrator can measure the actual `.tut-bubble`
// element. A wrapper div won't work because `.tut-bubble` is `position: fixed`
// and would report `offsetHeight: 0` on its parent.

export const TutorialTooltip = forwardRef(function TutorialTooltip({
  title,
  body,
  stepIndex,
  totalSteps,
  isFirst,
  isLast,
  onPrev,
  onNext,
  onSkip,
  style,
  centered,
  placement,
}, ref) {
  const { t } = useT();
  const enterClass =
    placement === "top" ? " tut-bubble--enter-from-below" :
    placement === "bottom" ? " tut-bubble--enter-from-above" :
    " tut-bubble--enter-center";
  const className = `tut-bubble${centered ? " tut-bubble--center" : ""}${enterClass}`;

  return (
    <div
      ref={ref}
      className={className}
      style={centered ? undefined : style}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tut-title"
      aria-describedby="tut-body"
    >
      {!isLast && (
        <button
          type="button"
          className="tut-bubble-close"
          onClick={onSkip}
          aria-label={t("tutorial.skipAria")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="6" y1="18" x2="18" y2="6" />
          </svg>
        </button>
      )}
      <div id="tut-title" className="tut-bubble-title">{title}</div>
      <div id="tut-body" className="tut-bubble-body">{body}</div>
      <div
        className="tut-bubble-dots"
        role="progressbar"
        aria-valuenow={stepIndex + 1}
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-label={`${stepIndex + 1} / ${totalSteps}`}
      >
        {Array.from({ length: totalSteps }, (_, i) => (
          <span
            key={i}
            className={`tut-dot${i === stepIndex ? " tut-dot--active" : ""}${i < stepIndex ? " tut-dot--done" : ""}`}
          />
        ))}
      </div>
      <div className="tut-bubble-actions">
        {!isFirst ? (
          <button type="button" className="tut-btn tut-btn-ghost" onClick={onPrev}>
            {t("tutorial.prev")}
          </button>
        ) : <span />}
        <button type="button" className="tut-btn tut-btn-primary" onClick={onNext}>
          {isLast ? t("tutorial.finish") : t("tutorial.next")}
        </button>
      </div>
    </div>
  );
});
