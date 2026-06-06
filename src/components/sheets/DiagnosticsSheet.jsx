import { useEffect, useState } from "react";
import { useEscape } from "../../hooks/useEscape";
import { useSheetExit } from "../../hooks/useSheetExit";
import { isNative, getPlatform } from "../../lib/platform";
import { haptic } from "../../utils/haptics";
import { checkNativePermission } from "../../lib/nativePush";

/* ── DiagnosticsSheet ─────────────────────────────────────────────
   Bottom sheet that surfaces platform + push + haptics state so the
   user can sanity-check the native build on a real device without
   wiring up Chrome remote-debugging or Xcode's console. Reached from
   Settings' "Diagnóstico" row, which is gated on isNative() || DEV —
   never surfaces in the production web build that regular users see.

   Read-only info + a few test buttons. No destructive actions: the
   point is to verify wiring, not to mutate state. */

export function DiagnosticsSheet({ open, onClose, notifications }) {
  const [nativePerm, setNativePerm] = useState(null);
  const [launchUrl, setLaunchUrl] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const { exiting, animatedClose } = useSheetExit(open, onClose);
  useEscape(open ? animatedClose : null);

  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    if (isNative()) {
      checkNativePermission().then(setNativePerm).catch(() => {});
      // App.getLaunchUrl() returns the URL that opened the app (if
      // the user tapped a Universal Link). Empty/null when the app
      // was launched normally. Useful for verifying deep-link routing.
      import("@capacitor/app")
        .then((m) => m.App.getLaunchUrl())
        .then((r) => setLaunchUrl(r?.url || "(none)"))
        .catch(() => setLaunchUrl("(error)"));
    }
  }, [open]);

  if (!open) return null;

  const release = typeof __SENTRY_RELEASE__ !== "undefined" ? __SENTRY_RELEASE__ : "(none)";
  const deployId = typeof __VERCEL_DEPLOYMENT_ID__ !== "undefined" ? __VERCEL_DEPLOYMENT_ID__ : "(none)";

  const lines = [
    ["Platform", getPlatform()],
    ["Native", String(isNative())],
    ["Sentry release", release || "(empty)"],
    ["Deployment ID", deployId || "(empty)"],
    ["Push supported", String(notifications?.supported)],
    ["Push enabled (server)", String(notifications?.enabled)],
    ["Push permission (browser)", notifications?.permission || "(n/a)"],
    ["Push permission (native)", nativePerm || "(n/a)"],
    ["Reminder window", `${notifications?.reminderMinutes ?? "?"} min`],
    ["Launch URL", launchUrl || "(n/a)"],
    ["User agent", navigator.userAgent],
  ];

  const handleTestPush = async () => {
    if (!notifications?.sendTest) return;
    setTestResult("Enviando…");
    const r = await notifications.sendTest();
    setTestResult(r.ok ? "✓ Enviado" : `✗ ${r.code || "error"}`);
  };

  return (
    <div className={`sheet-overlay ${exiting ? "sheet-overlay--exit" : ""}`} onClick={animatedClose}>
      <div
        className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Diagnóstico"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Diagnóstico</span>
          <button
            type="button"
            className="sheet-close"
            onClick={animatedClose}
            aria-label="Cerrar"
          >×</button>
        </div>
        <div style={{ padding: "0 20px 24px" }}>
          <div style={{
            background: "var(--cream)",
            borderRadius: "var(--radius)",
            padding: 12,
            marginBottom: 16,
            fontFamily: "monospace",
            fontSize: 11,
            lineHeight: 1.6,
            wordBreak: "break-all",
          }}>
            {lines.map(([k, v]) => (
              <div key={k}>
                <strong style={{ color: "var(--charcoal)" }}>{k}:</strong>{" "}
                <span style={{ color: "var(--charcoal-md)" }}>{v}</span>
              </div>
            ))}
          </div>

          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.06em", color: "var(--charcoal-xl)",
            marginBottom: 8,
          }}>
            Pruebas
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={handleTestPush}>
              Enviar push de prueba{testResult ? ` — ${testResult}` : ""}
            </button>
            <button type="button" className="btn btn-secondary" onClick={haptic.tap}>
              Haptic — tap
            </button>
            <button type="button" className="btn btn-secondary" onClick={haptic.success}>
              Haptic — success
            </button>
            <button type="button" className="btn btn-secondary" onClick={haptic.warn}>
              Haptic — warn
            </button>
          </div>

          <div style={{
            marginTop: 16, fontSize: 11, color: "var(--charcoal-xl)",
            textAlign: "center", lineHeight: 1.5,
          }}>
            Esta vista solo aparece en compilaciones nativas y en desarrollo.
            Útil para verificar que el push y los haptics funcionan en un dispositivo real.
          </div>
        </div>
      </div>
    </div>
  );
}
