import { useT } from "../../../i18n/index";
import { IconX, IconBell } from "../../../components/Icons";
import { Toggle } from "../../../components/Toggle";
import { Expando } from "../../../components/Expando";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { PushInstallCard } from "../../../components/PushInstallCard";
import { NextRemindersPreview } from "../NextRemindersPreview";
import { haptic } from "../../../utils/haptics";
import { notifErrorKey } from "./notifErrorKey";
import { SheetOverlay } from "../../../components/SheetOverlay";

/* ── Notifications sheet ───────────────────────────────────────────────
   Extracted from Settings.tsx. PRESENTATIONAL: the notifications hook,
   the toggle/reactivate handlers, and the bell-FX + pending state stay in
   Settings and thread in as same-name props, so the JSX moved verbatim.
   Shared focus-trap + drag wiring threads through setSheetPanel /
   sheetPanelHandlers. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export interface NotificationsSheetProps {
  open: boolean;
  notifications: Row;
  togglePending: boolean;
  bellFx: boolean;
  handleToggleNotifications: () => void | Promise<void>;
  handleReconcileReactivate: () => void | Promise<void>;
  showToast: (msg: string, kind?: string) => void;
  setActiveSheet: (key: string | null) => void;
  setSheetPanel: (el: HTMLDivElement | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheetPanelHandlers: Record<string, any>;
}

export function NotificationsSheet({
  open, notifications, togglePending, bellFx,
  handleToggleNotifications, handleReconcileReactivate, showToast,
  setActiveSheet, setSheetPanel, sheetPanelHandlers,
}: NotificationsSheetProps) {
  const { t } = useT();
  if (!open) return null;
  return (
        <SheetOverlay onClose={() => setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.notificationsRowTitle")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setActiveSheet(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              {notifications?.needsInstall ? (
                <PushInstallCard />
              ) : notifications?.permission === "denied" ? (
                <div className="push-amber-card" role="alert" style={{ margin:0 }}>
                  <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
                    <div style={{
                      flexShrink:0, width:36, height:36, borderRadius:"50%",
                      background:"var(--amber)", color:"var(--white)",
                      display:"flex", alignItems:"center", justifyContent:"center",
                    }}>
                      <IconBell size={18} />
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{
                        fontFamily:"var(--font-d)", fontWeight:800,
                        fontSize:"var(--text-md)", color:"var(--charcoal)",
                      }}>
                        {t("notifications.blockedTitle")}
                      </div>
                      <div style={{
                        fontSize:"var(--text-sm)", color:"var(--charcoal-md)",
                        marginTop:4, lineHeight:1.4,
                      }}>
                        {t("notifications.blockedBody")}
                      </div>
                    </div>
                  </div>
                  <ol style={{
                    listStyle:"none", margin:0, padding:0,
                    display:"flex", flexDirection:"column", gap:6,
                  }}>
                    {[
                      t("notifications.blockedStep1"),
                      t("notifications.blockedStep2"),
                      t("notifications.blockedStep3"),
                    ].map((step, i) => (
                      <li key={i} style={{
                        display:"flex", gap:10, alignItems:"center",
                        fontSize:"var(--text-sm)", color:"var(--charcoal)",
                        padding:"6px 8px",
                        background:"rgba(255,255,255,0.55)",
                        borderRadius:8,
                      }}>
                        <span style={{
                          flexShrink:0, width:20, height:20, borderRadius:"50%",
                          background:"var(--amber)", color:"var(--white)",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize:11, fontWeight:800,
                        }}>{i + 1}</span>
                        <span style={{ lineHeight:1.3 }}>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <>
                  {notifications?.reconciledOff && (
                    <div className="push-inline-banner" style={{ marginBottom:12 }}>
                      <div style={{
                        flexShrink:0, width:22, height:22, borderRadius:"50%",
                        background:"var(--amber)", color:"var(--white)",
                        display:"flex", alignItems:"center", justifyContent:"center",
                        marginTop:2,
                      }}>
                        <IconBell size={12} />
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{
                          fontFamily:"var(--font-d)", fontWeight:700,
                          fontSize:"var(--text-sm)", color:"var(--charcoal)",
                        }}>
                          {t("notifications.reconciledBannerTitle")}
                        </div>
                        <div style={{ fontSize:12, color:"var(--charcoal-md)", marginTop:2, lineHeight:1.35 }}>
                          {t("notifications.reconciledBannerBody")}
                        </div>
                        <button
                          type="button"
                          onClick={handleReconcileReactivate}
                          disabled={togglePending}
                          style={{
                            marginTop:8, height:28, padding:"0 12px",
                            fontSize:12, fontWeight:700,
                            background:"var(--amber)", color:"var(--white)",
                            border:"none", borderRadius:6, cursor: togglePending ? "default" : "pointer",
                            opacity: togglePending ? 0.7 : 1,
                          }}
                        >
                          {t("notifications.reconciledBannerAction")}
                        </button>
                      </div>
                      <button
                        type="button"
                        aria-label={t("close")}
                        onClick={() => notifications.clearReconciliationMessage?.()}
                        style={{
                          flexShrink:0, width:24, height:24, border:"none",
                          background:"transparent", cursor:"pointer",
                          color:"var(--charcoal-xl)",
                          display:"flex", alignItems:"center", justifyContent:"center",
                        }}
                      >
                        <IconX size={12} />
                      </button>
                    </div>
                  )}

                  <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 0", borderBottom:"1px solid var(--border-lt)" }}>
                    <div
                      className={`settings-row-icon${bellFx ? " bell-ring bell-glow" : ""}`}
                      style={{ color:"var(--teal-dark)" }}
                    >
                      <IconBell size={18} />
                    </div>
                    <div style={{ flex:1 }}>
                      <div className="settings-row-title">{t("notifications.sessionReminders")}</div>
                      <div className="settings-row-sub">
                        {notifications?.enabled
                          ? t("notifications.enabled")
                          : t("notifications.sessionRemindersDesc")}
                      </div>
                    </div>
                    <Toggle
                      on={!!notifications?.enabled}
                      onToggle={handleToggleNotifications}
                      disabled={togglePending}
                      ariaLabel={t("notifications.sessionReminders")}
                    />
                  </div>

                  <Expando open={!!notifications?.enabled}>
                    <div style={{ padding:"14px 0 4px" }}>
                      <div style={{
                        fontSize:12, fontWeight:700,
                        color:"var(--charcoal-md)", letterSpacing:0.2,
                        textTransform:"uppercase",
                        margin:"0 2px 8px",
                      }}>
                        {t("notifications.reminderTime")}
                      </div>
                      <SegmentedControl
                        role="group"
                        ariaLabel={t("notifications.reminderTime")}
                        items={[
                          { k: 15, l: "15 min" },
                          { k: 30, l: "30 min" },
                          { k: 60, l: "1 hr" },
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- numeric keys; control compares with ===
                        ] as any}
                        value={notifications?.reminderMinutes}
                        onChange={async (v: Row) => {
                          if (v === notifications?.reminderMinutes) return;
                          haptic.tap();
                          const res = await notifications?.setReminderMinutes(v);
                          if (res && !res.ok) {
                            showToast(t(notifErrorKey(res.code)), "error");
                          }
                        }}
                      />
                    </div>
                    {/* Próximas notificaciones — concrete preview of when
                        reminders will fire over the next 24h based on
                        scheduled sessions + the chosen offset. Closes
                        the "what does my setting actually do" gap. */}
                    <NextRemindersPreview minutes={notifications?.reminderMinutes || 30} />
                  </Expando>
                </>
              )}
            </div>
          </div>
        </SheetOverlay>
  );
}
