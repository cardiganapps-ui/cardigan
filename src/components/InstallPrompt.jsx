import { useState } from "react";
import { useT } from "../i18n/index";

// True only for iOS Safari tab mode (not PWA). PWA and every other browser
// get nothing. This is the one environment where the app can meaningfully
// nudge toward a full-screen experience.
function isIOSSafariNotInstalled() {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (!isIOS) return false;
  const isStandalone = window.navigator.standalone === true
    || window.matchMedia("(display-mode: standalone)").matches;
  return !isStandalone;
}

/**
 * Non-dismissible install nudge shown only to iOS Safari users. The prompt
 * is intentionally persistent: the only way to get rid of it is to actually
 * install the app to the home screen, at which point the standalone check
 * above returns true and this component renders nothing. That's by design —
 * a dismissed banner is a forgotten banner, and we want every iOS Safari
 * user to land in the PWA eventually.
 *
 * Tap to expand/collapse the numbered two-step install instructions.
 */
export function InstallPrompt() {
  const { t } = useT();
  const [show] = useState(isIOSSafariNotInstalled);
  const [expanded, setExpanded] = useState(false);

  if (!show) return null;

  return (
    <div className="install-prompt" role="region" aria-label={t("install.title")}>
      <button
        type="button"
        className="install-prompt-body"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}>
        <span className="install-prompt-icon" aria-hidden="true">
          {/* Share arrow — matches the iOS Safari share glyph users need to tap */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </span>
        <span className="install-prompt-text">
          <strong>{t("install.title")}</strong>
          <span className="install-prompt-sub">{expanded ? t("install.addToHome") : t("install.instructions", { icon: "↑" })}</span>
        </span>
      </button>
      {expanded && (
        <div className="install-prompt-steps">
          <div className="install-prompt-step">
            <span className="install-prompt-step-num">1</span>
            <span>
              {t("install.tapButton")}{" "}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "middle", display: "inline-block" }}>
                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>{" "}
              {t("install.safariButton")}
            </span>
          </div>
          <div className="install-prompt-step">
            <span className="install-prompt-step-num">2</span>
            <span>{t("install.selectLabel")} <strong>"{t("install.selectAdd")}"</strong></span>
          </div>
        </div>
      )}
    </div>
  );
}
