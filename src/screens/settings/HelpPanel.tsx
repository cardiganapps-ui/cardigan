import React from "react";
import { IconStar, IconRefresh, IconChevron } from "../../components/Icons";
import { isNative } from "../../lib/platform";
import { clickableProps } from "../../utils/a11y";
import { useT } from "../../i18n/index";

export const HelpPanel = React.memo(function HelpPanel({
  updateChecking, updateStatus, onRestartTutorial, onCheckForUpdate,
}: {
  updateChecking?: boolean;
  updateStatus?: { tone?: string; msg?: string } | null;
  onRestartTutorial: () => void;
  onCheckForUpdate: () => void;
}) {
  const { t } = useT();
  return (
    <>
      {/* ── AYUDA ── */}
      <div className="settings-label">{t("settings.sectionHelp")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        <div className="settings-row" {...clickableProps(onRestartTutorial)}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconStar size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("tutorial.settingsRow")}</div>
            <div className="settings-row-sub">{t("tutorial.settingsRowSub")}</div>
          </div>
          <IconChevron />
        </div>
        {/* Service-worker update check is a PWA/web concern. Inside the
            native app the App Store handles updates and the SW path just
            reports "tu navegador no soporta…", so hide the row on native. */}
        {!isNative() && (
          <div className="settings-row" style={{ cursor: updateChecking ? "default" : "pointer" }} {...clickableProps(onCheckForUpdate)}>
            <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconRefresh size={18} /></div>
            <div style={{ flex:1 }}>
              <div className="settings-row-title">{t("settings.checkUpdate") || "Buscar actualización"}</div>
              {updateStatus && <div className="settings-row-sub" style={{ color: updateStatus.tone === "err" ? "var(--red)" : updateStatus.tone === "ok" ? "var(--green)" : "var(--charcoal-md)" }}>{updateStatus.msg}</div>}
            </div>
            {updateChecking ? <span style={{ fontSize:12, color:"var(--charcoal-xl)" }}>…</span> : <IconChevron />}
          </div>
        )}
      </div>
    </>
  );
});
