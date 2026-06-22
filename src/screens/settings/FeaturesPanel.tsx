import React from "react";
import { IconUsers } from "../../components/Icons";
import { Toggle } from "../../components/Toggle";
import { useT } from "../../i18n/index";

export const FeaturesPanel = React.memo(function FeaturesPanel({
  groupsEnabled, groupsToggleLocked, readOnly, setGroupsEnabled,
}: {
  groupsEnabled?: boolean;
  groupsToggleLocked?: boolean;
  readOnly?: boolean;
  setGroupsEnabled?: (v: boolean) => void;
}) {
  const { t } = useT();
  return (
    <>
      {/* ── FUNCIONES ── */}
      <div className="settings-label">{t("settings.sectionFeatures")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        <div className="settings-row" style={{ cursor:"default" }}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconUsers size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.groupsFeature")}</div>
            <div className="settings-row-sub">
              {groupsToggleLocked ? t("settings.groupsFeatureLocked") : t("settings.groupsFeatureSub")}
            </div>
          </div>
          <Toggle
            on={groupsEnabled !== false}
            disabled={readOnly || groupsToggleLocked}
            onToggle={() => setGroupsEnabled?.(!(groupsEnabled !== false))}
          />
        </div>
      </div>
    </>
  );
});
