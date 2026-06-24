import React from "react";
import { IconShield, IconKey, IconLock, IconChevron } from "../../components/Icons";
import { clickableProps } from "../../utils/a11y";
import { useT } from "../../i18n/index";
import { ProBadge } from "./ProBadge";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed mfa/passkeys/noteCrypto hook objects
type Row = any;

export const SecurityPanel = React.memo(function SecurityPanel({
  readOnly, mfa, passkeys, noteCrypto, isPro, showEncryptionSetup, encSummary,
  onOpenMfa, onOpenPasskeys, onOpenEncryption,
}: {
  readOnly?: boolean;
  mfa: Row;
  passkeys: Row;
  noteCrypto?: Row;
  isPro?: boolean;
  showEncryptionSetup?: boolean;
  encSummary?: React.ReactNode;
  onOpenMfa: () => void;
  onOpenPasskeys: () => void;
  onOpenEncryption: () => void;
}) {
  const { t } = useT();
  if (readOnly) return null;
  return (
    <>
      {/* ── SEGURIDAD ── */}
      <div className="settings-label">{t("settings.sectionSecurity")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        <div className="settings-row" style={{ cursor: mfa.loading ? "default" : "pointer" }}
          {...clickableProps(onOpenMfa)}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconShield size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.mfaTitle")}</div>
            <div className="settings-row-sub">
              {mfa.loading ? "…" : mfa.factors.length > 0 ? t("settings.mfaActive") : t("settings.mfaInactive")}
            </div>
          </div>
          <IconChevron />
        </div>
        {passkeys.supported && (
          <div className="settings-row" style={{ cursor: passkeys.loading ? "default" : "pointer" }}
            {...clickableProps(() => { if (!passkeys.loading) onOpenPasskeys(); })}>
            <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconKey size={18} /></div>
            <div style={{ flex:1 }}>
              <div className="settings-row-title">{t("settings.passkeyTitle")}</div>
              <div className="settings-row-sub">
                {passkeys.loading
                  ? "…"
                  : passkeys.passkeys.length > 0
                    ? t("settings.passkeyRowCount", { count: passkeys.passkeys.length })
                    : t("settings.passkeyRowNone")}
              </div>
            </div>
            <IconChevron />
          </div>
        )}
        {noteCrypto && noteCrypto.status !== "loading" && (showEncryptionSetup || noteCrypto.status !== "disabled") && (
          <div className="settings-row" {...clickableProps(onOpenEncryption)}>
            <div className="settings-row-icon" style={{ color: noteCrypto.status === "unlocked" ? "var(--green)" : noteCrypto.status === "locked" ? "var(--charcoal-md)" : (!isPro && noteCrypto.status === "disabled" ? "var(--charcoal-xl)" : "var(--teal-dark)") }}>
              <IconLock size={18} />
            </div>
            <div style={{ flex:1 }}>
              <div className="settings-row-title" style={{ display:"flex", alignItems:"center", gap:6 }}>
                {t("settings.encryptionTitle")}
                {!isPro && noteCrypto.status === "disabled" && <ProBadge />}
              </div>
              <div className="settings-row-sub">
                {!isPro && noteCrypto.status === "disabled" ? t("settings.proRowLockedSub") : encSummary}
              </div>
            </div>
            <IconChevron />
          </div>
        )}
      </div>
    </>
  );
});
