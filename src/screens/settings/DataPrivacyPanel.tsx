import React from "react";
import { IconDownload, IconDocument, IconChevron } from "../../components/Icons";
import { useT } from "../../i18n/index";

export const DataPrivacyPanel = React.memo(function DataPrivacyPanel({
  readOnly, exporting, onOpenExport, onOpenPrivacyPolicy,
}: {
  readOnly?: boolean;
  exporting?: boolean;
  onOpenExport: () => void;
  onOpenPrivacyPolicy: () => void;
}) {
  const { t } = useT();
  return (
    <>
      {/* ── DATOS Y PRIVACIDAD ── */}
      <div className="settings-label">{t("settings.sectionPrivacyData")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        {!readOnly && (
          <div className="settings-row" style={{ cursor: exporting ? "default" : "pointer" }}
            onClick={() => { if (!exporting) onOpenExport(); }}>
            <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconDownload size={18} /></div>
            <div style={{ flex:1 }}>
              <div className="settings-row-title">{t("settings.privacyExport")}</div>
              <div className="settings-row-sub">{t("settings.privacyExportSub")}</div>
            </div>
            {exporting ? <span style={{ fontSize:12, color:"var(--charcoal-xl)" }}>…</span> : <IconChevron />}
          </div>
        )}
        <div className="settings-row" onClick={onOpenPrivacyPolicy}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconDocument size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.privacyPolicy")}</div>
            <div className="settings-row-sub">{t("settings.privacyPolicySub")}</div>
          </div>
          <IconChevron />
        </div>
      </div>
    </>
  );
});
