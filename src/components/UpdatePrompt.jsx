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
    // Failsafe: main.jsx reloads on controllerchange, but if the SW
    // activation hangs (rare; observed once in production with the
    // toast stuck in "Actualizando…"), fall back to a hard reload
    // after 4s. Reload picks up the new assets either way.
    setTimeout(() => {
      try { window.location.reload(); } catch { /* page already gone */ }
    }, 4000);
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
      <div className="update-prompt-toast">
        <span style={{ flex: 1 }}>{t("updateAvailable")}</span>
        <button
          type="button"
          className="update-prompt-action"
          onClick={apply}
          disabled={applying}>
          {applying ? t("updating") : t("updateNow")}
        </button>
      </div>
    </div>
  );
}
