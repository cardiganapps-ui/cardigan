import { useState } from "react";
import { IconBell, IconX } from "./Icons";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";

/* ── First-run notifications prompt ──
   Gentle card that appears on Home when a user is eligible for push
   but hasn't turned it on. Shown once per device — dismissal is
   recorded in localStorage so it doesn't reappear, and enabling the
   feature implicitly dismisses it. Silent no-op if the user has
   already enabled, denied permission, or is on an iOS Safari tab that
   can't receive push yet (the Settings row surfaces the install hint
   in that case).

   Why a prompt at all: only 1 of 3 active users had a push_sub row
   when we diagnosed — burying the control in Settings means most
   users never find it. */

const DISMISS_KEY = "cardigan.notifications.promptDismissed";

function isDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === "1"; }
  catch { return false; }
}
function markDismissed() {
  try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
}

export function NotificationsPrompt() {
  const { t } = useT();
  const { notifications, showToast } = useCardigan();
  const [hidden, setHidden] = useState(() => isDismissed());
  const [busy, setBusy] = useState(false);

  // Keep the banner hidden once the user enables push, regardless of
  // dismissal state — no reason to keep showing it if they're
  // already opted in. Adjust-state-during-render pattern on the
  // enabled transition.
  const enabled = notifications?.enabled;
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    if (enabled) setHidden(true);
  }

  if (!notifications) return null;
  if (hidden) return null;
  if (notifications.loading) return null;
  if (!notifications.supported) return null;
  if (notifications.needsInstall) return null;          // iOS Safari tab
  if (notifications.enabled) return null;
  if (notifications.permission === "denied") return null; // can't recover via UI

  const handleEnable = async () => {
    if (busy) return;
    setBusy(true);
    const res = await notifications.enable();
    setBusy(false);
    if (res?.ok) {
      showToast(t("notifications.toastEnabled"), "success");
      markDismissed();
      setHidden(true);
    } else if (res?.code === "permission-denied") {
      showToast(t("notifications.toastPermissionDenied"), "warning");
      // Hide the banner — user actively chose "Block", no point
      // offering the prompt again on every Home visit.
      markDismissed();
      setHidden(true);
    } else {
      showToast(t("notifications.toastSubscribeFailed"), "error");
      // Keep banner visible so user can retry.
    }
  };

  const handleDismiss = () => {
    markDismissed();
    setHidden(true);
  };

  return (
    <div
      role="region"
      aria-label={t("notifications.promptTitle")}
      style={{
        margin: "12px 16px 0",
        padding: "14px 14px 14px 14px",
        background: "var(--teal-pale)",
        border: "1px solid var(--teal-mist)",
        borderRadius: "var(--radius)",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        animation: "fadeIn 0.25s ease",
      }}>
      <div style={{
        flexShrink: 0,
        width: 36, height: 36,
        borderRadius: "50%",
        background: "var(--teal)",
        color: "#FFFFFF",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <IconBell size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: "var(--text-md)", color: "var(--charcoal)" }}>
          {t("notifications.promptTitle")}
        </div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)", marginTop: 3, lineHeight: 1.35 }}>
          {t("notifications.promptBody")}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-teal"
            onClick={handleEnable}
            disabled={busy}
            style={{
              height: 34, padding: "0 14px",
              fontSize: "var(--text-sm)",
              width: "auto", minHeight: 0,
              display: "inline-flex", alignItems: "center", gap: 6,
              opacity: busy ? 0.85 : 1,
            }}>
            {busy && (
              <span
                aria-hidden="true"
                style={{
                  width: 12, height: 12, borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.45)",
                  borderTopColor: "#FFFFFF",
                  animation: "togglePendingSpin 0.7s linear infinite",
                  boxSizing: "border-box",
                }}
              />
            )}
            {t("notifications.promptEnable")}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            style={{
              height: 34, padding: "0 12px", fontSize: "var(--text-sm)", fontWeight: 600,
              background: "transparent", border: "none", cursor: "pointer",
              color: "var(--charcoal-md)", fontFamily: "var(--font)",
            }}>
            {t("notifications.promptDismiss")}
          </button>
        </div>
      </div>
      <button
        type="button"
        aria-label={t("notifications.promptDismiss")}
        onClick={handleDismiss}
        style={{
          flexShrink: 0,
          width: 26, height: 26,
          background: "transparent", border: "none", cursor: "pointer",
          color: "var(--charcoal-xl)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginRight: -4, marginTop: -4,
        }}>
        <IconX size={12} />
      </button>
    </div>
  );
}
