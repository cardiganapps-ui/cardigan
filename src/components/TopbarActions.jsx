import { useState, useEffect, useRef } from "react";
import { IconPlus, IconSearch } from "./Icons";
import { QUICK_ACTIONS } from "./QuickActions";
import { useCardigan } from "../context/CardiganContext";
import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n/index";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/i.test(navigator.platform);

export default function TopbarActions({ onOpenPalette }) {
  const { t } = useT();
  const { requestFabAction, readOnly } = useCardigan();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEscape(open ? () => setOpen(false) : null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (readOnly) return null;

  const handlePick = (key) => {
    setOpen(false);
    requestFabAction?.(key);
  };

  return (
    <div className="topbar-actions" ref={wrapRef}>
      {onOpenPalette && (
        <button
          type="button"
          className="topbar-search-btn"
          onClick={onOpenPalette}
          aria-label={t("cmdp.open") || "Buscar / comandos"}
          title={isMac ? "\u2318K o /" : "Ctrl+K o /"}
        >
          <IconSearch size={15} />
        </button>
      )}
      <button
        type="button"
        className={`topbar-new-btn ${open ? "topbar-new-btn--open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <IconPlus size={14} strokeWidth={2.4} />
        <span>{t("add")}</span>
      </button>
      {open && (
        <div className="topbar-new-menu" role="menu">
          {QUICK_ACTIONS.map((a, i) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              className="topbar-new-item"
              onClick={() => handlePick(a.key)}
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <span className="topbar-new-item-icon"><a.Icon size={15} /></span>
              <span className="topbar-new-item-label">{t(a.tKey)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
