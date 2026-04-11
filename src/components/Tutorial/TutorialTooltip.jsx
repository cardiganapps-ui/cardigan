import { useT } from "../../i18n/index";

// Tooltip bubble with title, body, progress indicator and action buttons.
// Positioning is handled by the orchestrator via the `style` prop; this
// component only renders content and fires callbacks.

export function TutorialTooltip({
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
}) {
  const { t } = useT();
  const className = `tut-bubble${centered ? " tut-bubble--center" : ""}`;
  return (
    <div
      className={className}
      style={centered ? undefined : style}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tut-title"
      aria-describedby="tut-body"
    >
      <div id="tut-title" className="tut-bubble-title">{title}</div>
      <div id="tut-body" className="tut-bubble-body">{body}</div>
      <div className="tut-bubble-footer">
        <span className="tut-bubble-progress">
          {t("tutorial.stepOf", { current: stepIndex + 1, total: totalSteps })}
        </span>
        <div className="tut-bubble-actions">
          {!isFirst && (
            <button type="button" className="tut-btn tut-btn-ghost" onClick={onPrev}>
              {t("tutorial.prev")}
            </button>
          )}
          {!isLast && (
            <button type="button" className="tut-btn tut-btn-ghost" onClick={onSkip}>
              {t("tutorial.skip")}
            </button>
          )}
          <button type="button" className="tut-btn tut-btn-primary" onClick={onNext}>
            {isLast ? t("tutorial.finish") : t("tutorial.next")}
          </button>
        </div>
      </div>
    </div>
  );
}
