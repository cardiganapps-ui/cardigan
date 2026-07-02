import React from "react";
import { IconBell, IconCalendar, IconCreditCard, IconChevron, IconSmartphone } from "../../components/Icons";
import { clickableProps } from "../../utils/a11y";
import { useT } from "../../i18n/index";
import { isNative, isIOS } from "../../lib/platform";
import { ProBadge } from "./ProBadge";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed notifications hook object
type Row = any;

export const NotificationsCalendarPanel = React.memo(function NotificationsCalendarPanel({
  notifications, readOnly, bellFx, notifSummary, isPro, calendarSummary,
  requirePro, onOpenSheet,
}: {
  notifications?: Row;
  readOnly?: boolean;
  bellFx?: boolean;
  notifSummary?: React.ReactNode;
  isPro?: boolean;
  calendarSummary?: React.ReactNode;
  requirePro?: (feature: string) => void;
  onOpenSheet: (sheet: string) => void;
}) {
  const { t } = useT();
  if (!(notifications?.supported || !readOnly)) return null;
  return (
    <>
      {/* ── NOTIFICACIONES Y CALENDARIO ──
         Notifications row opens a sub-sheet absorbing all of the
         notification UI states (install gate, blocked, toggle +
         reminder time). Calendar row opens a sheet wrapping the
         CalendarLinkPanel — both surfaces are about how the user gets
         told about their schedule, so they belong together. */}
      <div className="settings-label">{t("settings.sectionNotifCal")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        {notifications?.supported && (
          <div className="settings-row" {...clickableProps(() => onOpenSheet("notifications"))}>
            <div
              className={`settings-row-icon${bellFx ? " bell-ring bell-glow" : ""}`}
              style={{ color:"var(--teal-dark)" }}
            >
              <IconBell size={18} />
            </div>
            <div style={{ flex:1 }}>
              <div className="settings-row-title">{t("settings.notificationsRowTitle")}</div>
              <div className="settings-row-sub">{notifSummary}</div>
            </div>
            <IconChevron />
          </div>
        )}
        {!readOnly && (
          <div
            className="settings-row"
            {...clickableProps(() => isPro ? onOpenSheet("calendar") : requirePro?.("calendar"))}
          >
            <div className="settings-row-icon" style={{ color: isPro ? "var(--teal-dark)" : "var(--charcoal-xl)" }}><IconCalendar size={18} /></div>
            <div style={{ flex:1 }}>
              <div className="settings-row-title" style={{ display:"flex", alignItems:"center", gap:6 }}>
                {t("settings.calendarLabel")}
                {!isPro && <ProBadge />}
              </div>
              <div className="settings-row-sub">{isPro ? calendarSummary : t("settings.proRowLockedSub")}</div>
            </div>
            <IconChevron />
          </div>
        )}
        {/* iOS home/lock-screen widgets — the row only exists inside the
           native iOS shell, where the WidgetBridge plugin is compiled in. */}
        {!readOnly && isNative() && isIOS() && (
          <div className="settings-row" {...clickableProps(() => onOpenSheet("widgets"))}>
            <div className="settings-row-icon" style={{ color: "var(--teal-dark)" }}><IconSmartphone size={18} /></div>
            <div style={{ flex:1 }}>
              <div className="settings-row-title">{t("settings.widgetsLabel")}</div>
              <div className="settings-row-sub">{t("settings.widgetsSub")}</div>
            </div>
            <IconChevron />
          </div>
        )}
        {!readOnly && (
          <div
            className="settings-row"
            {...clickableProps(() => isPro ? onOpenSheet("onlinePayments") : requirePro?.("onlinePayments"))}
          >
            <div className="settings-row-icon" style={{ color: isPro ? "var(--teal-dark)" : "var(--charcoal-xl)" }}><IconCreditCard size={18} /></div>
            <div style={{ flex:1 }}>
              <div className="settings-row-title" style={{ display:"flex", alignItems:"center", gap:6 }}>
                {t("settings.onlinePaymentsLabel")}
                {!isPro && <ProBadge />}
              </div>
              <div className="settings-row-sub">{isPro ? t("settings.onlinePaymentsSub") : t("settings.proRowLockedSub")}</div>
            </div>
            <IconChevron />
          </div>
        )}
      </div>
    </>
  );
});
