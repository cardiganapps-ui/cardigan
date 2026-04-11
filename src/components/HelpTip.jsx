import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";

/**
 * Contextual help popover anchored to a small "?" button.
 *
 * Props:
 *  - tipsKey: i18n key resolving to an array of bullet strings (e.g. "help.home")
 *  - title: optional string — falls back to t("help.title")
 *
 * Tap the button to open; tap outside, press ESC, or tap again to close.
 */
export function HelpTip({ tipsKey, title }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const tips = t(tipsKey);
  const resolvedTitle = title ?? t("help.title");

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

  return (
    <div className="help-tip-wrap" ref={wrapRef}>
      <button
        type="button"
        className="help-icon-btn"
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
