import { useEffect } from "react";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useNotifications } from "../../hooks/useNotifications";
import { Toggle } from "../../components/Toggle";
import { CalendarLinkPanel } from "../../components/CalendarLinkPanel";
import { IconBell, IconCalendar, IconLogOut, IconX } from "../../components/Icons";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useState } from "react";
import { haptic } from "../../utils/haptics";

/* ── PatientSettingsSheet ─────────────────────────────────────────
   Tiny settings drawer for the patient-side portal. Three rows:

     1. Recordatorios push — toggle for the per-user
        notification_preferences row. Reuses the same useNotifications
        hook the therapist app uses (it works identically for patient
        users — the cron has its own branch that resolves "is this
        user_id a patient?" and queries the right session set).
     2. Calendario — reuses CalendarLinkPanel verbatim. The /api/
        calendar/[token] endpoint also branches on patient vs.
        therapist, so the same UI ships both feed flavors.
     3. Cerrar sesión — confirmation dialog, then sign out.

   Deliberately spartan. Patients aren't power users; one screen with
   the three things they actually need beats a tabbed Settings tree. */

const REMINDER_OPTIONS = [
  { value: 15, labelKey: "notifications.15min" },
  { value: 30, labelKey: "notifications.30min" },
  { value: 60, labelKey: "notifications.60min" },
];

export function PatientSettingsSheet({ open, onClose, user, signOut }) {
  const { t } = useT();
  const { showToast, setHideFab } = useCardigan();
  const notifications = useNotifications(user);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [togglePending, setTogglePending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHideFab?.(true);
    return () => setHideFab?.(false);
  }, [open, setHideFab]);

  useEscape(open ? onClose : null);
  const panelRef = useFocusTrap(!!open);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose, { isOpen: open });
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  if (!open) return null;

  const handleToggleNotifications = async () => {
    if (togglePending || !notifications) return;
    if (notifications.needsInstall) {
      showToast(t("notifications.toastInstallRequired"), "warning");
      return;
    }
    setTogglePending(true);
    try {
      if (notifications.enabled) {
        const res = await notifications.disable();
        if (res?.ok) { haptic.tap(); showToast(t("notifications.toastDisabled"), "info"); }
        else { haptic.warn(); showToast(t("notifications.toastSubscribeFailed"), "error"); }
      } else {
        const res = await notifications.enable();
        if (res?.ok) { haptic.tap(); showToast(t("notifications.toastEnabled"), "success"); }
        else if (res?.code === "permission-denied") {
          haptic.warn();
          showToast(t("notifications.toastPermissionDenied"), "warning");
        } else {
          haptic.warn();
          showToast(t("notifications.toastSubscribeFailed"), "error");
        }
      }
    } finally {
      setTogglePending(false);
    }
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        ref={setPanel}
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("patientSettings.title")}
        onClick={(e) => e.stopPropagation()}
        {...panelHandlers}
        style={{ maxHeight: "92vh" }}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("patientSettings.title")}</span>
          <button
            type="button"
            className="sheet-close"
            onClick={onClose}
            aria-label={t("close")}
          >
            <IconX size={14} />
          </button>
        </div>
        <div style={{ padding: "0 20px 28px" }}>
          {/* ── Recordatorios ── */}
          <div
            style={{
              padding: "14px 0",
              borderBottom: "1px solid var(--border-lt)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "var(--teal-pale)",
                  color: "var(--teal-dark)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                <IconBell size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "var(--font-d)",
                    fontWeight: 700,
                    fontSize: 14,
                    color: "var(--charcoal)",
                  }}
                >
                  {t("patientSettings.notificationsTitle")}
                </div>
                <div style={{ fontSize: 12, color: "var(--charcoal-md)", marginTop: 2, lineHeight: 1.4 }}>
                  {notifications?.needsInstall
                    ? t("notifications.installRequired")
                    : notifications?.permission === "denied"
                      ? t("notifications.permissionDenied")
                      : t("patientSettings.notificationsBody")}
                </div>
              </div>
              <Toggle
                on={!!notifications?.enabled}
                disabled={togglePending || !notifications?.supported || notifications?.needsInstall || notifications?.permission === "denied"}
                ariaLabel={t("patientSettings.notificationsTitle")}
                onToggle={handleToggleNotifications}
              />
            </div>
            {/* Reminder timing — only meaningful when notifications
                are on. Same options the therapist app exposes. */}
            {notifications?.enabled && (
              <div style={{ display: "flex", gap: 6, marginTop: 12, marginLeft: 48 }}>
                {REMINDER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => notifications.setReminderMinutes(opt.value)}
                    style={{
                      padding: "5px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                      borderRadius: "var(--radius-pill)",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "var(--font)",
                      background: notifications.reminderMinutes === opt.value
                        ? "var(--teal)"
                        : "var(--cream)",
                      color: notifications.reminderMinutes === opt.value
                        ? "var(--white)"
                        : "var(--charcoal-md)",
                    }}
                  >
                    {t(opt.labelKey)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Calendario ── */}
          <div
            style={{
              padding: "14px 0",
              borderBottom: "1px solid var(--border-lt)",
            }}
          >
            <CalendarLinkPanel />
          </div>

          {/* ── Sign out ── */}
          <button
            type="button"
            onClick={() => setConfirmSignOut(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              width: "100%",
              padding: "16px 0",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font)",
              textAlign: "left",
              color: "var(--charcoal)",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: "var(--cream)",
                color: "var(--charcoal-md)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
              aria-hidden="true"
            >
              <IconLogOut size={16} />
            </div>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>
              {t("nav.signOut")}
            </span>
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmSignOut}
        title={t("nav.signOut")}
        body={t("nav.signOutConfirm")}
        confirmLabel={t("nav.signOut")}
        destructive
        onConfirm={() => {
          setConfirmSignOut(false);
          signOut?.();
        }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </div>
  );
}
