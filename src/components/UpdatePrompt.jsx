import { useEffect, useState } from "react";
import { useT } from "../i18n/index";

/* ── Update prompt ──
   main.jsx watches for a waiting service worker and dispatches
   'cardigan-update-ready' with the waiting SW as detail. We show a
   small toast here so the user opts in to reloading — avoiding an
   automatic refresh mid-typing. On accept we postMessage to the SW,
   which calls skipWaiting(); the controllerchange handler in
   main.jsx then reloads the page. */

export function UpdatePrompt() {
  const { t } = useT();
  const [waitingSW, setWaitingSW] = useState(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const onReady = (e) => setWaitingSW(e.detail || null);
    window.addEventListener("cardigan-update-ready", onReady);
    return () => window.removeEventListener("cardigan-update-ready", onReady);
  }, []);

  if (!waitingSW) return null;

  const apply = () => {
    setApplying(true);
    try { waitingSW.postMessage({ type: "SKIP_WAITING" }); }
    catch { /* SW went away — the next focus will re-check anyway. */ }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: "calc(var(--sat, 44px) + 52px)",
        left: 12, right: 12,
        zIndex: "var(--z-install)",
        animation: "toastIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}>
      <div style={{
        background: "var(--charcoal)", color: "var(--white)",
        padding: "12px 16px", borderRadius: "var(--radius)",
        fontSize: "var(--text-md)", fontWeight: 600,
        fontFamily: "var(--font)",
        boxShadow: "var(--shadow-lg)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ flex: 1 }}>{t("updateAvailable")}</span>
        <button
          type="button"
          onClick={apply}
          disabled={applying}
          style={{
            background: "var(--teal)",
            color: "var(--white)", border: "none",
            borderRadius: "var(--radius-pill)",
            padding: "6px 14px",
            fontSize: "var(--text-sm)", fontWeight: 700,
            fontFamily: "var(--font)",
            cursor: "pointer", flexShrink: 0, minHeight: 0,
            opacity: applying ? 0.6 : 1,
          }}>
          {applying ? t("saving") : t("updateNow")}
        </button>
      </div>
    </div>
  );
}
