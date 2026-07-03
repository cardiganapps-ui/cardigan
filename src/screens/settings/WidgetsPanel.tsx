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

    // Every step runs ISOLATED: its own timer, its own try/catch, its own
    // race-timeout. One hung step can't block the next, so the readout
    // always reaches the end and shows exactly which step is slow/broken.
    // Ordered so the App Group state (debugState) is read FIRST — that's
    // the fact that decides whether the bridge write ever lands.
    const step = async <T,>(label: string, ms: number, fn: () => Promise<T>): Promise<T | undefined> => {
      const t0 = performance.now();
      try {
        const race = Promise.race([
          fn(),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
        ]);
        const r = await race;
        paint(`✓ ${label} (${Math.round(performance.now() - t0)}ms)`);
        return r;
      } catch (e) {
        paint(`✗ ${label} (${Math.round(performance.now() - t0)}ms): ${(e as Error)?.message || String(e)}`);
        return undefined;
      }
    };

    try {
      paint(`inicio ${new Date().toISOString().slice(11, 19)}`);
      paint(`widgetsDisabled(local): ${widgetsDisabled()}`);
      paint(`datos: p=${patients?.length ?? "?"} s=${upcomingSessions?.length ?? "?"} pay=${payments?.length ?? "?"}`);

      // (0) Registration — synchronous, cannot hang. PluginHeaders is the
      // DECISIVE native-truth: native's JSExport injects an entry here when
      // it registers a plugin, so its presence/absence proves whether the
      // native side ever registered WidgetBridge (isPluginAvailable only
      // reflects the JS proxy and can be true even when native didn't).
      try {
        const { Capacitor } = await import("@capacitor/core");
        paint(`isPluginAvailable(WidgetBridge): ${Capacitor.isPluginAvailable("WidgetBridge")}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cap = (window as any).Capacitor;
        const headers: string = Array.isArray(cap?.PluginHeaders)
          ? cap.PluginHeaders.map((h: { name: string }) => h.name).join(",")
          : "(none)";
        paint(`PluginHeaders(native): ${headers.slice(0, 220)}`);
        paint(`WidgetBridge en PluginHeaders: ${/(^|,)WidgetBridge($|,)/.test(headers)}`);
        const keys = cap?.Plugins ? Object.keys(cap.Plugins).join(",") : "(none)";
        paint(`Capacitor.Plugins: ${keys.slice(0, 160)}`);
      } catch (e) { paint(`✗ core import: ${(e as Error)?.message}`); }

      // (1) debugState FIRST — reads the App Group directly. The one fact
      // that's been missing: is the shared container reachable, does it
      // already hold a snapshot/token, when did the widget last run.
      const before = await step("debugState#1", 5000, () => widgetDebugState());
      if (before && !("error" in before)) {
        paint(`   appGroup=${before.appGroupAvailable} suite=${before.suiteName}`);
        paint(`   snapshotBytes=${before.snapshotBytes} hasToken=${before.hasToken}`);
        paint(`   widgetLastRun=${before.widgetLastRun || "(nunca)"} ${before.widgetLastState || ""}`);
      } else if (before === null) {
        paint("   (plugin null — bridge no disponible)");
      }

      // (2) Isolated tiny bridge WRITE — proves the native setSnapshot
      // handler round-trips, independent of the builder.
      const { setWidgetSnapshot } = await import("../../lib/widgetBridge");
      await step("setSnapshot(tiny)", 5000, () => setWidgetSnapshot('{"v":1,"probe":1}'));

      // (3) Builder on REAL data — pure CPU, timed on its own. If this is
      // slow, the hang is data-shape; if instant, it's the bridge.
      await step("buildSnapshot(real)", 8000, async () => {
        const { buildWidgetSnapshot } = await import("../../utils/widgetSnapshot");
        const groupNameById = new Map((groups || []).map((g) => [g.id, g.name]));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const withGroups = (upcomingSessions || []).map((s: any) =>
          s.group_id ? { ...s, groups: { name: groupNameById.get(s.group_id) || null } } : s
        );
        const snap = buildWidgetSnapshot({
          sessions: withGroups, patients, payments,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        const json = JSON.stringify(snap);
        paint(`   snapshot=${json.length}B sesionesHoy=${snap.sessionsToday.length}`);
        // (4) Real write, same isolated timer.
        await setWidgetSnapshot(json);
        return json.length;
      });

      // (5) Re-read App Group to confirm the write landed.
      const after = await step("debugState#2", 5000, () => widgetDebugState());
      if (after && !("error" in after)) {
        paint(`   snapshotBytes=${after.snapshotBytes} hasToken=${after.hasToken}`);
      }

      paint("fin ✓");
    } catch (err) {
      paint(`✗ excepción: ${(err as Error)?.message || String(err)}`);
    } finally {
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
