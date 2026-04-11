import { useT } from "../../i18n/index";
import { LogoIcon } from "../LogoMark";
import { useEscape } from "../../hooks/useEscape";

// Centered welcome card asking the user whether they want the guided tour.
// Rendered when tutorial state is "welcome".

export function TutorialWelcome({ onAccept, onDecline }) {
  const { t } = useT();
  useEscape(onDecline);

  return (
    <div className="tut-welcome-overlay" role="dialog" aria-modal="true" aria-labelledby="tut-welcome-title">
      <div className="tut-welcome-card" onClick={(e) => e.stopPropagation()}>
        <div className="tut-welcome-logo">
          <LogoIcon size={28} color="currentColor" />
        </div>
        <div id="tut-welcome-title" className="tut-welcome-title">
          {t("tutorial.welcomeTitle")}
        </div>
        <div className="tut-welcome-body">
          {t("tutorial.welcomeBody")}
        </div>
        <div className="tut-welcome-actions">
          <button type="button" className="tut-btn tut-btn-primary" style={{ height: 44, fontSize: 14 }} onClick={onAccept}>
            {t("tutorial.welcomeYes")}
          </button>
          <button type="button" className="tut-btn tut-btn-ghost" style={{ height: 40 }} onClick={onDecline}>
            {t("tutorial.welcomeNo")}
          </button>
        </div>
      </div>
    </div>
  );
}
