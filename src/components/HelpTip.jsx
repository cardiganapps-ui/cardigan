import { useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";
import { IconX } from "./Icons";

/**
 * Contextual help anchored to a small "?" button in the top bar.
 *
 * Opens as a bottom sheet (the app's canonical modal) rather than an
 * absolutely-positioned popover. The popover version mis-positioned and
 * clipped on native iOS — the global `zoom` the Capacitor shell applies
 * threw off the `top:100% / right:0` anchoring, and its translucency let
 * the content behind bleed through and garble the text. A sheet sidesteps
 * all of that: it's `position: fixed`, bottom-anchored, fully opaque, and
 * uses the exact same primitives every other modal in the app relies on,
 * so it renders cleanly on phone, iPad, and the native shell.
 *
 * Props:
 *  - tipsKey: i18n key resolving to an array of bullet strings (e.g. "help.home").
 *              Empty/missing array → renders nothing (suppresses the button
 *              on screens without useful tips).
 *  - variant: "default" | "dark" — styles the trigger button for light vs
 *             dark surfaces (topbar / expediente header).
 */
export function HelpTip({ tipsKey, variant = "default" }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  const tips = t(tipsKey);
  const ariaLabel = t("help.ariaLabel");

  // Close on route change — the screen that rendered us is going away.
  // Adjust-state-during-render pattern; avoids the set-state-in-effect cascade.
  const [prevTipsKey, setPrevTipsKey] = useState(tipsKey);
  if (tipsKey !== prevTipsKey) {
    setPrevTipsKey(tipsKey);
    setOpen(false);
  }

  useEscape(open ? () => setOpen(false) : null);

  if (!Array.isArray(tips) || tips.length === 0) return null;

  const btnClass = `help-icon-btn${variant === "dark" ? " help-icon-btn--dark" : ""}`;

  return (
    <>
      <button
        type="button"
        className={btnClass}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        ?
      </button>
      {open && createPortal(
        // Portal to <body>: the top bar (where this lives) has a
        // backdrop-filter, which creates a containing block that would
        // trap the position:fixed overlay inside the bar. Rendering at
        // the body root lets the sheet anchor to the viewport.
        <div className="sheet-overlay" onClick={() => setOpen(false)}>
          <div
            className="sheet-panel help-tip-sheet"
            role="dialog"
            aria-label={ariaLabel}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{ariaLabel}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setOpen(false)}>
                <IconX size={14} />
              </button>
            </div>
            <div style={{ padding: "0 20px 24px" }}>
              <ul className="help-tip-list">
                {tips.map((tip, i) => <li key={i}>{tip}</li>)}
              </ul>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
