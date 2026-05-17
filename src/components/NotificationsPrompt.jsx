import { useState, useEffect, useRef } from "react";
import { IconBell, IconX } from "./Icons";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { track } from "../lib/analytics";

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

const DISMISS_KEY_INITIAL      = "cardigan.notifications.promptDismissed";
const DISMISS_KEY_POST_PATIENT = "cardigan.notifications.promptDismissed.postPatient";

function dismissKey(variant) {
  return variant === "post_patient" ? DISMISS_KEY_POST_PATIENT : DISMISS_KEY_INITIAL;
}
function isDismissed(variant) {
  try { return localStorage.getItem(dismissKey(variant)) === "1"; }
  catch { return false; }
}
function markDismissed(variant) {
  try { localStorage.setItem(dismissKey(variant), "1"); } catch { /* ignore */ }
}

export function NotificationsPrompt({ variant = "initial" } = {}) {
  const { t } = useT();
  const { notifications, showToast, readOnly } = useCardigan();
  const [hidden, setHidden] = useState(() => isDismissed(variant));
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

  // Trial-expired (read-only) users can't act on reminders without a
  // paid sub — hiding the prompt avoids inviting them into a flow
  // that ends in a paywall pop-up.
  const visible =
       !readOnly
    && !!notifications
    && !hidden
    && !notifications.loading
    && !!notifications.supported
    && !notifications.needsInstall
    && !notifications.enabled
    && notifications.permission !== "denied";

  // Fire `notification_prompt_shown` once per (variant, mount transition).
  // The ref guard prevents repeated fires during re-renders while the
  // card stays mounted.
  const trackedRef = useRef(false);
  useEffect(() => {
    if (visible && !trackedRef.current) {
      trackedRef.current = true;
      track("notification_prompt_shown", { variant });
    } else if (!visible) {
      trackedRef.current = false;
    }
  }, [visible, variant]);

  if (!visible) return null;

  const handleEnable = async () => {
    if (busy) return;
    setBusy(true);
    const res = await notifications.enable();
    setBusy(false);
    if (res?.ok) {
      // No success toast — the prompt dismisses itself and the
      // Settings toggle (when reachable) renders as enabled. Toast
      // would be redundant on a flow that already animates away.
      markDismissed(variant);
      setHidden(true);
    } else if (res?.code === "permission-denied") {
      showToast(t("notifications.toastPermissionDenied"), "warning");
      // Hide the banner — user actively chose "Block", no point
      // offering the prompt again on every Home visit.
      markDismissed(variant);
      setHidden(true);
    } else {
      showToast(t("notifications.toastSubscribeFailed"), "error");
      // Keep banner visible so user can retry.
    }
  };

  const handleDismiss = () => {
    markDismissed(variant);
    setHidden(true);
  };

  const promptTitle = variant === "post_patient"
    ? t("notifications.promptTitlePostPatient")
    : t("notifications.promptTitle");
  const promptBody = variant === "post_patient"
    ? t("notifications.promptBodyPostPatient")
    : t("notifications.promptBody");

  return (
    <div
      role="region"
      aria-label={promptTitle}
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
        color: "var(--white)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <IconBell size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: "var(--text-md)", color: "var(--charcoal)" }}>
          {promptTitle}
        </div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)", marginTop: 3, lineHeight: 1.35 }}>
          {promptBody}
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
                  borderTopColor: "var(--white)",
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
          width: 36, height: 36,
          background: "transparent", border: "none", cursor: "pointer",
          color: "var(--charcoal-xl)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginRight: -8, marginTop: -8,
        }}>
        <IconX size={14} />
      </button>
    </div>
  );
}
