import { useState, useEffect } from "react";
import { IconX } from "./Icons";
import { useT } from "../i18n/index";

const LS_KEY = "cardigan-install-dismissed";

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
 * Thin dismissible banner shown only to iOS Safari users (not PWA users).
 * Explains how to install the app to the home screen in two steps — the
 * Cardigan PWA in standalone mode has no browser chrome, which reclaims
 * a lot of vertical real estate and eliminates the 307-redirect auth
 * edge cases that come with Safari tab mode.
 */
export function InstallPrompt() {
  const { t } = useT();
  const [show, setShow] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!isIOSSafariNotInstalled()) return;
    let dismissed = false;
    try { dismissed = !!localStorage.getItem(LS_KEY); } catch {}
    if (dismissed) return;
    setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(LS_KEY, "1"); } catch {}
  };

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
      <button
        type="button"
        className="install-prompt-dismiss"
        onClick={dismiss}
        aria-label={t("install.dontShowAgain")}>
        <IconX size={12} />
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
