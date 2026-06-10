import { useState } from "react";
import { useT } from "../i18n/index";
import { isNative } from "../lib/platform";

const DISMISS_KEY = "cardigan.install.dismissed";

// True only for iOS Safari tab mode (not PWA). PWA, every other browser,
// and the native iOS/Android shells get nothing. This hint exists solely
// to nudge browser users toward the home-screen install; inside the
// native app there's nothing to install. Safari's own toolbar can't be
// hidden from a tab — the standalone PWA is the only chrome-free path,
// so this points the way there.
function isIOSSafariNotInstalled() {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  if (isNative()) return false;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (!isIOS) return false;
  const isStandalone = window.navigator.standalone === true
    || window.matchMedia("(display-mode: standalone)").matches;
  if (isStandalone) return false;
  // One-time: once dismissed, never nag again on this device.
  try { if (window.localStorage.getItem(DISMISS_KEY) === "1") return false; } catch { /* private mode */ }
  return true;
}

/**
 * Dismissible, one-time install hint shown only to iOS Safari users (tab
 * mode, not the installed PWA, not the native shell). It answers the one
 * thing a website can't do on its own — get rid of Safari's bottom toolbar:
 * the chrome-free experience only exists once the app is on the home screen,
 * so this hint shows users how to get there.
 *
 * It disappears for good once the user either (a) taps the ✕ to dismiss, or
 * (b) installs to the home screen (the standalone check then returns false).
 * Tap the body to expand/collapse the numbered two-step instructions.
 */
export function InstallPrompt() {
  const { t } = useT();
  const [show, setShow] = useState(isIOSSafariNotInstalled);
  const [expanded, setExpanded] = useState(false);

  if (!show) return null;

  const dismiss = () => {
    try { window.localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ }
    setShow(false);
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
          <span className="install-prompt-sub">{expanded ? t("install.addToHome") : t("install.fullscreenHint")}</span>
        </span>
      </button>
      <button
        type="button"
        className="install-prompt-dismiss"
        onClick={dismiss}
        aria-label={t("install.dismiss")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      {expanded && (
        <div className="install-prompt-steps">
          <div className="install-prompt-step">
            <span className="install-prompt-step-num">1</span>
            <span>
              {t("install.tapButton")}{" "}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "middle", display: "inline-block" }} aria-hidden="true">
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
