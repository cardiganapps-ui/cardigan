import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { IconSmartphone } from "../../components/Icons";
import { useT } from "../../i18n/index";
import { useCardiganMain } from "../../context/CardiganContext";
import { useWidgetToken, setWidgetTokenState, refreshWidgetToken } from "../../hooks/useWidgetToken";
import { setWidgetToken, clearWidgetData, widgetDebugState, type WidgetDebugState } from "../../lib/widgetBridge";
import { widgetsDisabled, setWidgetsDisabled } from "../../lib/widgetSync";
import { useCardigan } from "../../context/CardiganContext";

/* iOS widgets management panel (Settings → Widgets, iOS native only).

   Widgets provision themselves on first app open (widgetSync lazily
   mints the data token), so the common case here is the "active"
   state: show status + how-to-add instructions + the privacy note,
   with Regenerar (rotate the token) and Desactivar (revoke + local
   opt-out flag so the lazy mint doesn't undo the choice) actions.

   Mirrors CalendarLinkPanel's structure; unlike the calendar URL the
   widget token is never displayed — it flows straight from the POST
   response into the App Group via WidgetBridge. */

export function WidgetsPanel({ readOnly = false }: { readOnly?: boolean }) {
  const { t } = useT();
  const { showToast } = useCardiganMain();
  const { hasToken, lastAccessedAt, loaded } = useWidgetToken();
  const { patients, upcomingSessions, payments, groups } = useCardigan();
  const [busy, setBusy] = useState(false);
  const [disabled, setDisabled] = useState(widgetsDisabled());
  const [diag, setDiag] = useState<string | null>(null);

  // The lazy mint can land after this panel's first GET — refetch on
  // mount so the status doesn't show "inactive" on a fresh login.
  useEffect(() => { refreshWidgetToken(); }, []);

  // Force a snapshot write + token mint, then read back the bridge/App
  // Group state. Built to be UN-STICKABLE: every stage paints into the
  // readout as it happens, every error is caught and displayed, and a
  // watchdog force-finishes after 12s — so whatever fails, the readout
  // says exactly where. (The previous version had no catch: any throw
  // left the label on "Ejecutando…" forever, which is what masked the
  // real failure on-device.)
  const runDiagnostic = async () => {
    if (busy) return;
    setBusy(true);
    const lines: string[] = [];
    const paint = (line: string) => { lines.push(line); setDiag(lines.join("\n")); };
    let finished = false;
    const watchdog = setTimeout(() => {
      if (!finished) paint("✗ watchdog: 12s sin terminar — etapa colgada ↑");
    }, 12000);
    try {
      paint(`inicio ${new Date().toISOString().slice(11, 19)}`);
      paint(`widgetsDisabled(local): ${widgetsDisabled()}`);
      paint(`datos: p=${patients?.length ?? "?"} s=${upcomingSessions?.length ?? "?"} pay=${payments?.length ?? "?"}`);

      // Ask Capacitor DIRECTLY whether the native class is registered —
      // synchronous, no bridge round-trip, cannot hang. THE decisive bit.
      try {
        const { Capacitor } = await import("@capacitor/core");
        paint(`isPluginAvailable(WidgetBridge): ${Capacitor.isPluginAvailable("WidgetBridge")}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const reg = (window as any).Capacitor?.Plugins ? Object.keys((window as any).Capacitor.Plugins).join(",") : "(n/a)";
        paint(`native plugins: ${reg.slice(0, 160)}`);
      } catch (e) { paint(`✗ core import: ${(e as Error)?.message}`); }

      paint("→ syncWidgets…");
      const { syncWidgets } = await import("../../lib/widgetSync");
      await syncWidgets({ patients, sessions: upcomingSessions, payments, groups });
      paint("✓ syncWidgets volvió");

      paint("→ debugState…");
      const state = await widgetDebugState();
      if (!state) paint("✗ bridge no disponible (plugin null)");
      else if ("error" in state) paint(`✗ debugState: ${state.error}`);
      else {
        paint(`appGroup: ${state.appGroupAvailable} | snapshotBytes: ${state.snapshotBytes} | hasToken: ${state.hasToken}`);
        paint(`widgetLastRun: ${state.widgetLastRun || "(nunca)"} | ${state.widgetLastState || ""}`);
      }
      paint("fin ✓");
    } catch (err) {
      paint(`✗ excepción: ${(err as Error)?.message || String(err)}`);
    } finally {
      finished = true;
      clearTimeout(watchdog);
      setBusy(false);
    }
  };

  const callWidgetToken = async (method: string) => {
    if (busy) return null;
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const access = session?.access_token;
      if (!access) { showToast(t("settings.widgetsError"), "error"); return null; }
      const res = await fetch("/api/widget-token", {
        method,
        headers: { "Authorization": `Bearer ${access}` },
      });
      if (!res.ok) { showToast(t("settings.widgetsError"), "error"); return null; }
      return await res.json();
    } catch {
      showToast(t("settings.widgetsError"), "error");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const provision = async (isRotate: boolean) => {
    if (isRotate && !confirm(t("settings.widgetsRotateConfirm"))) return;
    const j = await callWidgetToken("POST");
    if (!j?.token) return;
    await setWidgetToken(j.token);
    setWidgetsDisabled(false);
    setDisabled(false);
    setWidgetTokenState(j);
    showToast(isRotate ? t("settings.widgetsRotated") : t("settings.widgetsEnabled"), "success");
  };

  const disable = async () => {
    if (!confirm(t("settings.widgetsDisableConfirm"))) return;
    const j = await callWidgetToken("DELETE");
    if (!j) return;
    await clearWidgetData();
    setWidgetsDisabled(true);
    setDisabled(true);
    setWidgetTokenState(null);
    showToast(t("settings.widgetsDisabled"), "success");
  };

  const active = hasToken && !disabled;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ color: "var(--teal-dark)", marginTop: 2, flexShrink: 0 }}><IconSmartphone size={18} /></div>
        <div style={{ flex: 1 }}>
          <div className="settings-row-title" style={{ marginBottom: 4 }}>{t("settings.widgetsTitle")}</div>
          <div className="settings-row-sub" style={{ lineHeight: 1.5 }}>{t("settings.widgetsDescription")}</div>
        </div>
      </div>

      {/* Status band */}
      <div style={{
        background: active ? "var(--green-bg)" : "var(--cream)",
        color: active ? "var(--green)" : "var(--charcoal-md)",
        padding: "10px 12px",
        borderRadius: "var(--radius)",
        fontSize: 12,
        lineHeight: 1.5,
      }}>
        {!loaded
          ? t("loading")
          : active
            ? (lastAccessedAt
                ? t("settings.widgetsStatusActiveSeen", { date: new Date(lastAccessedAt).toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })
                : t("settings.widgetsStatusActive"))
            : t("settings.widgetsStatusInactive")}
      </div>

      {/* How to add */}
      <div className="settings-row-sub" style={{ lineHeight: 1.6 }}>
        {t("settings.widgetsHowTo")}
      </div>

      {/* Privacy note */}
      <div className="settings-row-sub" style={{ lineHeight: 1.6, color: "var(--charcoal-xl)" }}>
        {t("settings.widgetsPrivacyNote")}
      </div>

      {active ? (
        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => provision(true)}
            disabled={busy || readOnly}
            style={{ flex: 1 }}
          >
            {busy ? t("loading") : t("settings.widgetsRotate")}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={disable}
            disabled={busy || readOnly}
            style={{ flex: 1, color: "var(--red)" }}
          >
            {t("settings.widgetsDisable")}
          </button>
        </div>
      ) : (
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => provision(false)}
          disabled={busy || readOnly || !loaded}
        >
          {busy ? t("loading") : t("settings.widgetsEnable")}
        </button>
      )}

      {/* ── Diagnóstico ──
         Temporary readout to debug "active but not rendering". Reports
         whether the App Group bridge is reachable, whether the snapshot/
         token landed in the shared container, and the widget process's
         last heartbeat (proves cross-process sharing). */}
      <div style={{ marginTop: 4, paddingTop: 12, borderTop: "1px solid var(--border-lt)" }}>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={runDiagnostic}
          disabled={busy}
          style={{ width: "100%" }}
        >
          {busy ? "Ejecutando…" : "Forzar sincronización y diagnóstico"}
        </button>
        {diag && (
          <pre style={{
            marginTop: 10, padding: "10px 12px", background: "var(--cream)",
            borderRadius: "var(--radius)", fontSize: 11, lineHeight: 1.5,
            whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--charcoal-md)",
            fontFamily: "ui-monospace, monospace",
          }}>
            {diag}
          </pre>
        )}
      </div>
    </div>
  );
}
