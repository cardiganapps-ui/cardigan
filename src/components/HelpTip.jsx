import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";

/**
 * Contextual help popover anchored to a small "?" button.
 *
 * Props:
 *  - tipsKey: i18n key resolving to an array of bullet strings (e.g. "help.home").
 *              If the array is empty or missing, the component renders nothing —
 *              this is how we suppress the button on screens without useful tips.
 *  - title: optional string — falls back to t("help.title")
 *  - variant: "default" (default) for light backgrounds,
 *             "dark" for dark surfaces (topbar, expediente header)
 *
 * Tap the button to open; tap outside, press ESC, or tap again to close.
 */
export function HelpTip({ tipsKey, title, variant = "default" }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const tips = t(tipsKey);
  const resolvedTitle = title ?? t("help.title");

  // Close on route change — the screen that rendered us is going away.
  useEffect(() => {
    setOpen(false);
  }, [tipsKey]);

  useEscape(open ? () => setOpen(false) : null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  if (!Array.isArray(tips) || tips.length === 0) return null;

  const btnClass = `help-icon-btn${variant === "dark" ? " help-icon-btn--dark" : ""}`;

  return (
    <div className="help-tip-wrap" ref={wrapRef}>
      <button
        type="button"
        className={btnClass}
        aria-label={resolvedTitle}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        ?
      </button>
      {open && (
        <div className="help-tip" role="dialog" aria-label={resolvedTitle}>
          <div className="help-tip-title">{resolvedTitle}</div>
          <ul className="help-tip-list">
            {tips.map((tip, i) => <li key={i}>{tip}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
