import React from "react";
import { IconSparkle, IconUsers, IconKey, IconChevron } from "../../components/Icons";
import { clickableProps } from "../../utils/a11y";
import { useT } from "../../i18n/index";
import { MONETIZATION_ENABLED } from "../../config/monetization";
import { rowSubLine } from "../../utils/subscriptionStatus";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed subscription hook object
type Row = any;

export const SubscriptionPanel = React.memo(function SubscriptionPanel({
  subscription, message, activeSheet, onOpenSheet, onOpenChangePassword,
}: {
  subscription?: Row;
  message?: string | null;
  activeSheet?: string | null;
  onOpenSheet: (sheet: string) => void;
  onOpenChangePassword: () => void;
}) {
  const { t } = useT();
  return (
    <>
      {/* ── CUENTA ── */}
      <div className="settings-label">{t("settings.sectionAccount")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        {MONETIZATION_ENABLED && (
        <div className="settings-row" {...clickableProps(() => onOpenSheet("plan"))}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconSparkle size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.subscriptionTitle")}</div>
            <div className="settings-row-sub" style={subscription?.subscription?.status === "past_due" ? { color: "var(--amber)" } : undefined}>{(() => {
              const s = subscription || {};
              // Admin fallthrough: useSubscription returns active for
              // admins without comp/paid sub. rowSubLine doesn't have
              // an admin branch, so handle it here.
              if (!s.compGranted && !s.subscribedActive && s.accessState === "active") {
                return t("subscription.statusActive");
              }
              return rowSubLine(s, t);
            })()}</div>
          </div>
          <IconChevron />
        </div>
        )}
        {/* Referral row — surface the user's invite code directly so it's
            findable without going through the Suscripción sheet first. The
            sub-line shows the code (or "Genera tu código…" while the lazy
            fetch is running on first open). Tapping opens a dedicated sheet
            with the share UI + rewards tally. */}
        {MONETIZATION_ENABLED && (
        <div className="settings-row" {...clickableProps(() => onOpenSheet("referral"))}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconUsers size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.referralRowTitle")}</div>
            <div className="settings-row-sub">{(() => {
              const info = subscription?.referralInfo;
              if (info?.code) {
                return info.rewardsCount > 0
                  ? t("settings.referralRowSubWithRewards", { code: info.code, n: info.rewardsCount })
                  : t("settings.referralRowSubCode", { code: info.code });
              }
              if (subscription?.referralLoading) return t("settings.referralRowSubLoading");
              return t("settings.referralRowSubDefault");
            })()}</div>
          </div>
          <IconChevron />
        </div>
        )}
        <div className="settings-row"
          {...clickableProps(onOpenChangePassword)}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconKey size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.changePassword")}</div>
            {message && activeSheet === null && (
              <div className="settings-row-sub" style={{ color:"var(--green)" }}>{message}</div>
            )}
          </div>
          <IconChevron />
        </div>
      </div>
    </>
  );
});
