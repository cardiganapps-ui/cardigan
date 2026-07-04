import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { IconSmartphone } from "../../components/Icons";
import { useT } from "../../i18n/index";
import { useCardiganMain } from "../../context/CardiganContext";
import { useWidgetToken, setWidgetTokenState, refreshWidgetToken } from "../../hooks/useWidgetToken";
import { setWidgetToken, clearWidgetData } from "../../lib/widgetBridge";
import { widgetsDisabled, setWidgetsDisabled } from "../../lib/widgetSync";

/* iOS widgets management panel (Settings → Widgets, iOS native only).

   Widgets provision themselves on first app open (widgetSync lazily
   mints the data token), so the common case here is the "active"
   state: show status + how-to-add instructions + the privacy note,
   with Regenerar (rotate the token) and Desactivar (revoke + local
   opt-out flag so the lazy mint doesn't undo the choice) actions.

   Mirrors CalendarLinkPanel's structure; unlike the calendar URL the
   widget token is never displayed — it's staged in localStorage and the
   native CardiganBridgeViewController mirrors it into the App Group. */

export function WidgetsPanel({ readOnly = false }: { readOnly?: boolean }) {
  const { t } = useT();
  const { showToast } = useCardiganMain();
  const { hasToken, lastAccessedAt, loaded } = useWidgetToken();
  const [busy, setBusy] = useState(false);
  const [disabled, setDisabled] = useState(widgetsDisabled());

  // The lazy mint can land after this panel's first GET — refetch on
  // mount so the status doesn't show "inactive" on a fresh login.
  useEffect(() => { refreshWidgetToken(); }, []);

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
    </div>
  );
}
