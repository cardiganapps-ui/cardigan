import { useEffect, useState } from "react";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetExit } from "../../hooks/useSheetExit";
import { isNative, getPlatform } from "../../lib/platform";
import { haptic } from "../../utils/haptics";
import { checkNativePermission, subscribeNative } from "../../lib/nativePush";
import { IconBell, IconChevron } from "../Icons";
import { SheetOverlay } from "../SheetOverlay";

/* ── DiagnosticsSheet ─────────────────────────────────────────────
   Bottom sheet that surfaces push + haptics state so we can sanity-check
   the native build on a real device without wiring up Chrome remote-
   debugging or Xcode's console. Reached from Settings' "Diagnóstico" row,
   which is gated on isNative() || DEV — never surfaces in the production
   web build that regular users see.

   Layout: a friendly status summary up top, the push-relevant state as
   plain-language badge rows, the test buttons, and the raw technical dump
   tucked behind a "Detalles técnicos" disclosure (still there for support,
   just not a wall of monospace on open). Read-only info + a few test
   buttons — the point is to verify wiring, not to mutate state. */

declare const __SENTRY_RELEASE__: string | undefined;
declare const __VERCEL_DEPLOYMENT_ID__: string | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed notifications bag from context
type NotificationsBag = any;

const reminderLabel = (m?: number | null) =>
  m == null ? "—" : m === 60 ? "1 hora antes" : `${m} min antes`;

export function DiagnosticsSheet({ open, onClose, notifications }: {
  open?: boolean;
  onClose?: () => void;
  notifications?: NotificationsBag;
}) {
  const [nativePerm, setNativePerm] = useState<string | null>(null);
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [regResult, setRegResult] = useState<string | null>(null);
  const [showTech, setShowTech] = useState(false);

  const { exiting, animatedClose } = useSheetExit(!!open, onClose);
  useEscape(open ? animatedClose : null);
  const panelRef = useFocusTrap(!!open);

  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    setShowTech(false);
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

  // Push readiness — the one thing this sheet really answers.
  const permGranted = isNative()
    ? nativePerm === "granted"
    : notifications?.permission === "granted";
  const permDenied = isNative()
    ? nativePerm === "denied"
    : notifications?.permission === "denied";
  const supported = !!notifications?.supported;
  const enabled = !!notifications?.enabled;
  const ready = supported && enabled && permGranted;

  // Friendly summary copy keyed to the most actionable gap.
  let summary;
  if (ready) {
    summary = {
      tone: "ok",
      title: "Notificaciones activas",
      body: `Recibirás un aviso ${reminderLabel(notifications?.reminderMinutes)} de cada sesión.`,
    };
  } else if (!supported) {
    summary = {
      tone: "warn",
      title: "No disponibles aquí",
      body: "Este dispositivo no admite notificaciones push.",
    };
  } else if (permDenied) {
    summary = {
      tone: "warn",
      title: "Permiso bloqueado",
      body: "Actívalo en los ajustes del sistema para recibir recordatorios.",
    };
  } else if (!enabled) {
    summary = {
      tone: "warn",
      title: "Notificaciones desactivadas",
      body: "Actívalas desde Ajustes para recibir tus recordatorios de sesión.",
    };
  } else {
    summary = {
      tone: "warn",
      title: "Casi listo",
      body: "Falta conceder el permiso de notificaciones.",
    };
  }

  const okTone = summary.tone === "ok";
  const accent = okTone ? "var(--green)" : "var(--amber)";
  const accentBg = okTone ? "var(--green-bg)" : "var(--amber-bg)";

  // Plain-language status rows (the bits a human cares about).
  const statusRows: [string, [string, string]][] = [
    [
      "Notificaciones",
      enabled
        ? ["badge-green", "Activas"]
        : ["badge-gray", "Desactivadas"],
    ],
    [
      "Permiso del sistema",
      permGranted
        ? ["badge-green", "Concedido"]
        : permDenied
          ? ["badge-red", "Bloqueado"]
          : ["badge-gray", "Sin definir"],
    ],
    ["Aviso previo", ["badge-teal", reminderLabel(notifications?.reminderMinutes)]],
  ];

  // Raw technical fields — kept for support, hidden behind the disclosure.
  const techLines: [string, string][] = [
    ["Platform", getPlatform()],
    ["Native", String(isNative())],
    ["Push supported", String(supported)],
    ["Push permission (browser)", notifications?.permission || "(n/a)"],
    ["Push permission (native)", nativePerm || "(n/a)"],
    ["Sentry release", release || "(empty)"],
    ["Deployment ID", deployId || "(empty)"],
    ["Launch URL", launchUrl || "(n/a)"],
    ["User agent", navigator.userAgent],
  ];

  const handleTestPush = async () => {
    if (!notifications?.sendTest) return;
    setTestResult("Enviando…");
    const r = await notifications.sendTest();
    setTestResult(r.ok ? "✓ Enviado" : `✗ ${r.code || "error"}`);
  };

  // Isolates the on-device step: does iOS actually mint a push token?
  // ✓ → registration works (any failure is server/delivery); ✗ with the
  // error string tells us exactly why APNs registration failed.
  const handleProbeRegister = async () => {
    setRegResult("Probando…");
    try {
      const r = await subscribeNative();
      setRegResult(r.ok
        ? `✓ token ${r.platform} · ${(r.token || "").length} chars`
        : `✗ ${r.code}${r.error ? ` — ${r.error}` : ""}`);
    } catch (err) {
      setRegResult(`✗ excepción — ${(err as Error)?.message || String(err)}`);
    }
  };

  const eyebrow = {
    fontSize: 11, fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.06em", color: "var(--charcoal-xl)",
    marginBottom: 10,
  };

  return (
    <SheetOverlay exiting={exiting} onClose={animatedClose}>
      <div
        ref={(el) => { panelRef.current = el; }}
        className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Diagnóstico"
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
          {/* Friendly status summary */}
          <div style={{
            display: "flex", alignItems: "center", gap: 14,
            background: accentBg,
            border: `1px solid ${accent}22`,
            borderRadius: "var(--radius-lg)",
            padding: 16,
            marginBottom: 20,
          }}>
            <div style={{
              flexShrink: 0,
              width: 44, height: 44, borderRadius: "50%",
              background: "var(--white)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: accent,
            }}>
              <IconBell size={22} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontFamily: "var(--font-d)", fontWeight: 800,
                fontSize: "var(--text-lg)", color: "var(--charcoal)",
                letterSpacing: "-0.2px",
              }}>
                {summary.title}
              </div>
              <div style={{ fontSize: 13, color: "var(--charcoal-md)", lineHeight: 1.4, marginTop: 2 }}>
                {summary.body}
              </div>
            </div>
          </div>

          {/* Plain-language status rows */}
          <div style={eyebrow}>Estado</div>
          <div className="card" style={{ marginBottom: 20 }}>
            {statusRows.map(([label, [cls, text]], i) => (
              <div key={label} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "13px 16px",
                borderTop: i === 0 ? "none" : "1px solid var(--border-lt)",
              }}>
                <span style={{ fontSize: 14, color: "var(--charcoal)" }}>{label}</span>
                <span className={`badge ${cls}`} style={{ fontVariantNumeric: "tabular-nums" }}>{text}</span>
              </div>
            ))}
          </div>

          {/* Tests */}
          <div style={eyebrow}>Pruebas</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button type="button" className="btn btn-primary" onClick={handleTestPush}>
              Enviar notificación de prueba{testResult ? ` — ${testResult}` : ""}
            </button>
            {isNative() && (
              <button type="button" className="btn btn-secondary" onClick={handleProbeRegister} style={{ height: "auto", minHeight: 44, whiteSpace: "normal" }}>
                Probar registro de push{regResult ? ` — ${regResult}` : ""}
              </button>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={haptic.tap}>Tap</button>
              <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={haptic.success}>Éxito</button>
              <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={haptic.warn}>Alerta</button>
            </div>
            <div style={{ fontSize: 11, color: "var(--charcoal-xl)", textAlign: "center", marginTop: 2 }}>
              Vibración (haptics)
            </div>
          </div>

          {/* Technical details — collapsed by default */}
          <button
            type="button"
            className="btn-tap"
            onClick={() => setShowTech((v) => !v)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              width: "100%", marginTop: 20, padding: "10px 4px",
              background: "none", border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: 600, color: "var(--charcoal-md)",
            }}
          >
            <span>Detalles técnicos</span>
            <span style={{
              display: "inline-flex",
              transform: showTech ? "rotate(90deg)" : "none",
              transition: "transform var(--dur-fast) var(--ease-spring-soft)",
              color: "var(--charcoal-lt)",
            }}>
              <IconChevron size={16} />
            </span>
          </button>
          {showTech && (
            <div style={{
              background: "var(--cream)",
              borderRadius: "var(--radius)",
              padding: 12,
              marginTop: 4,
              fontFamily: "monospace",
              fontSize: 11,
              lineHeight: 1.6,
              wordBreak: "break-all",
            }}>
              {techLines.map(([k, v]) => (
                <div key={k}>
                  <strong style={{ color: "var(--charcoal)" }}>{k}:</strong>{" "}
                  <span style={{ color: "var(--charcoal-md)" }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{
            marginTop: 16, fontSize: 11, color: "var(--charcoal-xl)",
            textAlign: "center", lineHeight: 1.5,
          }}>
            Esta vista solo aparece en compilaciones nativas y en desarrollo.
          </div>
        </div>
      </div>
    </SheetOverlay>
  );
}
