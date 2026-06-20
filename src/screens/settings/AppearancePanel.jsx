import React from "react";
import { IconSun, IconMoon, IconChevron } from "../../components/Icons";
import { useT } from "../../i18n/index";

export const AppearancePanel = React.memo(function AppearancePanel({
  theme, accentTheme, onOpenSheet,
}) {
  const { t } = useT();
  return (
    <>
      {/* ── APARIENCIA ── */}
      <div className="settings-label">{t("settings.sectionAppearance")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        <div className="settings-row" onClick={() => onOpenSheet("theme")}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}>{theme?.resolvedTheme === "dark" ? <IconMoon size={18} /> : <IconSun size={18} />}</div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.appearance")}</div>
            <div className="settings-row-sub">{theme?.preference === "light" ? t("settings.themeLight") : theme?.preference === "dark" ? t("settings.themeDark") : t("settings.themeSystem")}</div>
          </div>
          <IconChevron />
        </div>
        <div className="settings-row" onClick={() => onOpenSheet("accent")}>
          <div className="settings-row-icon" aria-hidden="true">
            <span style={{ display:"inline-block", width:18, height:18, borderRadius:"50%", background:"var(--teal)", border:"1px solid var(--border-lt)" }} />
          </div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.accentColor")}</div>
            <div className="settings-row-sub">{t(`settings.accent.${accentTheme?.accent || "default"}`)}</div>
          </div>
          <IconChevron />
        </div>
      </div>
    </>
  );
});
