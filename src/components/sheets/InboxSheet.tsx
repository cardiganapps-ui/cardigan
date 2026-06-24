import { useState } from "react";
import { IconX, IconBell } from "../Icons";
import { SheetOverlay } from "../SheetOverlay";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useSheetExit } from "../../hooks/useSheetExit";
import { useCardiganMain } from "../../context/CardiganContext";

/* In-app notification inbox. Lists durable notification rows (migration
   077) newest-first, lets the user read (tap → mark read + jump to the
   linked screen), delete individual rows, mark all read, and clear all.
   Read-only modes (admin view-as-user, demo) hide the mutating actions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed notification rows
type Row = any;

export function InboxSheet({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const {
    inbox = [],
    inboxUnread = 0,
    readOnly,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
    clearNotifications,
    navigate,
  } = useCardiganMain();
  const [confirmClear, setConfirmClear] = useState(false);

  const { exiting, animatedClose } = useSheetExit(true, onClose);
  useEscape(animatedClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  const setPanel = (el: HTMLElement | null) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  const rel = (iso: string) => {
    const diff = new Date().getTime() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return t("inbox.justNow");
    if (m < 60) return t("inbox.minutesAgo", { count: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t("inbox.hoursAgo", { count: h });
    return t("inbox.daysAgo", { count: Math.floor(h / 24) });
  };

  const open = (n: Row) => {
    if (!readOnly && !n.read) markNotificationRead(n.id);
    const hash = (n.url || "").split("#")[1];
    animatedClose();
    // Defer navigation a tick so the sheet's exit animation isn't cut off
    // by the screen transition.
    if (hash) setTimeout(() => navigate(hash), 0);
  };

  return (
    <SheetOverlay exiting={exiting} onClose={animatedClose}>
      <div
        ref={setPanel}
        className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("inbox.title")}
        {...panelHandlers}
        style={{ display: "flex", flexDirection: "column" }}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">
            {t("inbox.title")}
            {inboxUnread > 0 && (
              <span className="badge badge-teal" style={{ marginLeft: 8, verticalAlign: "middle" }}>
                {inboxUnread === 1 ? t("inbox.unreadOne") : t("inbox.unreadMany", { count: inboxUnread })}
              </span>
            )}
          </span>
          <button className="sheet-close" aria-label={t("close")} onClick={animatedClose}><IconX size={14} /></button>
        </div>

        {inbox.length > 0 && !readOnly && (
          <div style={{ display: "flex", gap: 8, padding: "0 20px 8px", justifyContent: "flex-end" }}>
            {inboxUnread > 0 && (
              <button type="button" className="btn btn-ghost" style={{ height: 34, padding: "0 12px" }} onClick={markAllNotificationsRead}>
                {t("inbox.markAllRead")}
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ height: 34, padding: "0 12px", color: "var(--red)" }}
              onClick={() => {
                if (confirmClear) { clearNotifications(); setConfirmClear(false); }
                else setConfirmClear(true);
              }}
            >
              {confirmClear ? t("inbox.clearConfirm") : t("inbox.clearAll")}
            </button>
          </div>
        )}

        <div className="scroll-bounce" style={{ padding: "0 12px 24px", flex: "1 1 auto", overflowY: "auto", maxHeight: "70svh", minHeight: 140 }}>
          {inbox.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><IconBell size={20} /></div>
              <div className="empty-state-title">{t("inbox.empty")}</div>
              <div className="empty-state-body">{t("inbox.emptyBody")}</div>
            </div>
          ) : (
            inbox.map((n: Row) => (
              <div
                key={n.id}
                className="btn-tap"
                role="button"
                tabIndex={0}
                onClick={() => open(n)}
                onKeyDown={(e) => { if (e.key === "Enter") open(n); }}
                style={{
                  display: "flex", gap: 12, alignItems: "flex-start",
                  padding: "12px 8px", borderBottom: "1px solid var(--border-lt)",
                  cursor: "pointer",
                }}
              >
                <span style={{
                  flexShrink: 0, width: 34, height: 34, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: n.kind === "system" ? "var(--teal-pale)" : "var(--cream-dark)",
                  color: n.kind === "system" ? "var(--teal-dark)" : "var(--charcoal-md)",
                }}>
                  <IconBell size={16} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {!n.read && <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: "var(--teal)", flexShrink: 0 }} />}
                    <span style={{ fontFamily: "var(--font-d)", fontWeight: n.read ? 600 : 800, fontSize: 14, color: "var(--charcoal)" }}>{n.title}</span>
                  </div>
                  {n.body && <div style={{ fontSize: 13, color: "var(--charcoal-md)", marginTop: 2, lineHeight: 1.4 }}>{n.body}</div>}
                  <div style={{ fontSize: 11, color: "var(--charcoal-xl)", marginTop: 4 }}>{rel(n.created_at)}</div>
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    className="btn-tap"
                    aria-label={t("inbox.delete")}
                    onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                    style={{ background: "none", border: "none", color: "var(--charcoal-lt)", padding: 4, cursor: "pointer", flexShrink: 0 }}
                  >
                    <IconX size={16} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </SheetOverlay>
  );
}
