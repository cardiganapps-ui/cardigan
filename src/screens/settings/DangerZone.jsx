import React from "react";
import { IconSmartphone, IconLogOut, IconTrash, IconChevron } from "../../components/Icons";
import { isNative } from "../../lib/platform";
import { useT } from "../../i18n/index";

export const DangerZone = React.memo(function DangerZone({
  readOnly, onOpenDiagnostics, onSignOut, onOpenSignOutEverywhere, onOpenDeleteAccount,
}) {
  const { t } = useT();
  return (
    <>
      {/* ── SESIÓN ── */}
      <div className="settings-label">{t("settings.sectionSession")}</div>
      {/* Diagnostics — visible inside the native shell (where the user
          is QAing on a real device) and in dev. Hidden in the
          production web build that regular users see. The sheet
          surfaces platform/push/haptic state plus test buttons. */}
      {(isNative() || import.meta.env.DEV) && (
        <div className="card" style={{ margin:"0 16px", marginBottom: 12 }}>
          <div className="settings-row" onClick={onOpenDiagnostics}>
            <div className="settings-row-icon"><IconSmartphone size={18} /></div>
            <div style={{ flex:1 }}>
              <div className="settings-row-title">Diagnóstico</div>
              <div className="settings-row-sub">Plataforma, push y haptics</div>
            </div>
            <IconChevron />
          </div>
        </div>
      )}

      <div className="card" style={{ margin:"0 16px" }}>
        {/* Confirm before signing out — same ConfirmDialog the Drawer
            uses, so the affordance is consistent across both entry
            points (drawer chip + this row). */}
        <div className="settings-row" onClick={onSignOut}>
          <div className="settings-row-icon" style={{ color:"var(--red)" }}><IconLogOut size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title" style={{ color:"var(--red)" }}>{t("nav.signOut")}</div>
          </div>
          <IconChevron />
        </div>
        {!readOnly && (
          <div className="settings-row" onClick={onOpenSignOutEverywhere}>
            <div className="settings-row-icon" style={{ color:"var(--red)" }}><IconLogOut size={18} /></div>
            <div style={{ flex:1 }}>
              <div className="settings-row-title" style={{ color:"var(--red)" }}>{t("settings.signOutEverywhere")}</div>
              <div className="settings-row-sub">{t("settings.signOutEverywhereSub")}</div>
            </div>
            <IconChevron />
          </div>
        )}
      </div>

      {/* ── ZONA PELIGROSA ──
         Account deletion lives in its own bottom-of-page section so it
         can't be tapped by accident while scanning Settings. */}
      {!readOnly && (
        <>
          <div className="settings-label">{t("settings.dangerZone")}</div>
          <div className="card" style={{ margin:"0 16px" }}>
            <div className="settings-row" onClick={onOpenDeleteAccount}>
              <div className="settings-row-icon" style={{ color:"var(--red)" }}><IconTrash size={18} /></div>
              <div style={{ flex:1 }}>
                <div className="settings-row-title" style={{ color:"var(--red)" }}>{t("settings.privacyDelete")}</div>
                <div className="settings-row-sub">{t("settings.privacyDeleteSub")}</div>
              </div>
              <IconChevron />
            </div>
          </div>
        </>
      )}
    </>
  );
});
