import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/**
 * Convert a URL-safe base64 string to a Uint8Array (needed by PushManager.subscribe).
 */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * Detect whether we're on iOS but NOT installed as a standalone PWA.
 */
function isIOSNotStandalone() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone =
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  return isIOS && !isStandalone;
}

/**
 * POST the given PushSubscription to the server. Returns true on success.
 */
async function postSubscription(subscription) {
  const token = (await supabase.auth.getSession()).data?.session?.access_token;
  if (!token) return false;
  const resp = await fetch("/api/push-subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  return resp.ok;
}

/**
 * Create a fresh browser-level push subscription and hand it to the
 * server. Shared by the normal `enable()` path and the reconciliation
 * path that repairs a missing browser subscription for a user whose
 * preferences say `enabled: true`.
 */
async function subscribeAndPersist() {
  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  const ok = await postSubscription(subscription);
  return { ok, subscription };
}

export function useNotifications(user) {
  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    !!VAPID_PUBLIC_KEY;

  const [permission, setPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const [enabled, setEnabled] = useState(false);
  const [reminderMinutes, setReminderMinutesState] = useState(30);
  const [loading, setLoading] = useState(() => !!(user && supported));
  // Surfaced when reconciliation on load flips `enabled` off because
  // the browser subscription vanished between sessions (device swap,
  // browser data cleared, OS-level revoke). Consumers can show a one-
  // time toast and clear it via `clearReconciliationMessage()`.
  const [reconciledOff, setReconciledOff] = useState(false);
  const needsInstall = isIOSNotStandalone();

  // Fetch preferences + reconcile browser subscription state on mount.
  useEffect(() => {
    if (!user || !supported) return;

    let cancelled = false;

    async function init() {
      const { data } = await supabase
        .from("notification_preferences")
        .select("enabled, reminder_minutes")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      const prefEnabled = !!(data && data.enabled);
      if (data) {
        setReminderMinutesState(data.reminder_minutes || 30);
      }

      // Sync OS-level permission state.
      setPermission(Notification.permission);

      // Reconcile: if preferences say enabled, verify the browser
      // actually still has a subscription. Push subscriptions get
      // invalidated for many reasons that are invisible to our DB
      // (device change, browser data clear, user tapped "Block" in
      // the browser, silent vendor revoke). Without this check,
      // enabled=true was trusted forever and the user never realized
      // they'd stopped receiving reminders.
      if (prefEnabled) {
        try {
          const reg = await navigator.serviceWorker.ready;
          const existing = await reg.pushManager.getSubscription();
          if (cancelled) return;
          if (existing) {
            // Browser still has a subscription. Belt and braces: re-
            // post it to the server in case the server row was dropped
            // (RLS migration, manual cleanup). Ignore failures here;
            // the server either already had it or the next enable()
            // will re-try.
            postSubscription(existing).catch(() => {});
            setEnabled(true);
          } else if (Notification.permission === "granted") {
            // Permission is still granted, we just lost the browser
            // subscription. Re-subscribe silently — no UI prompt is
            // shown by subscribe() when permission is already granted.
            const { ok } = await subscribeAndPersist();
            if (cancelled) return;
            if (ok) setEnabled(true);
            else {
              // Couldn't re-subscribe; flip the pref off so the user
              // sees the correct state and can re-enable.
              await supabase.from("notification_preferences").upsert(
                { user_id: user.id, enabled: false, updated_at: new Date().toISOString() },
                { onConflict: "user_id" }
              );
              setEnabled(false);
              setReconciledOff(true);
            }
          } else {
            // Permission was revoked. Mirror that in our DB + flag for
            // the UI toast.
            await supabase.from("notification_preferences").upsert(
              { user_id: user.id, enabled: false, updated_at: new Date().toISOString() },
              { onConflict: "user_id" }
            );
            setEnabled(false);
            setReconciledOff(true);
          }
        } catch {
          // SW ready errored out — best effort, leave state as pref.
          setEnabled(prefEnabled);
        }
      } else {
        setEnabled(false);
      }

      if (!cancelled) setLoading(false);
    }

    init();
    return () => { cancelled = true; };
  }, [user, supported]);

  const clearReconciliationMessage = useCallback(() => setReconciledOff(false), []);

  /**
   * Request permission, subscribe to push, and persist to server.
   *
   * Returns a typed result:
   *   { ok: true }
   *   { ok: false, code: "unsupported" | "install-required" |
   *                       "permission-denied" | "subscribe-failed" |
   *                       "server-error" | "no-session" }
   *
   * Consumers are expected to map the code to a user-facing message.
   * Silent failures in the previous version were the single biggest
   * reason users thought push didn't work.
   */
  const enable = useCallback(async () => {
    if (!supported) return { ok: false, code: "unsupported" };
    if (!user) return { ok: false, code: "no-session" };
    if (needsInstall) return { ok: false, code: "install-required" };

    const perm = await Notification.requestPermission();
    setPermission(perm);
    if (perm !== "granted") return { ok: false, code: "permission-denied" };

    let subscription;
    try {
      const reg = await navigator.serviceWorker.ready;
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    } catch (err) {
      if (import.meta.env.DEV) console.error("pushManager.subscribe failed:", err);
      return { ok: false, code: "subscribe-failed" };
    }

    const serverOk = await postSubscription(subscription);
    if (!serverOk) {
      // Browser-level subscription exists but the server didn't accept
      // it. Undo the browser subscription so state stays consistent.
      try { await subscription.unsubscribe(); } catch { /* ignore */ }
      return { ok: false, code: "server-error" };
    }

    await supabase.from("notification_preferences").upsert(
      {
        user_id: user.id,
        enabled: true,
        reminder_minutes: reminderMinutes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    setEnabled(true);
    return { ok: true };
  }, [supported, user, reminderMinutes, needsInstall]);

  /**
   * Unsubscribe from push and update preferences.
   */
  const disable = useCallback(async () => {
    if (!supported || !user) return { ok: false, code: "unsupported" };

    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();

      if (subscription) {
        const token = (await supabase.auth.getSession()).data?.session?.access_token;
        await fetch("/api/push-unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => {});

        await subscription.unsubscribe().catch(() => {});
      }

      await supabase.from("notification_preferences").upsert(
        { user_id: user.id, enabled: false, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );

      setEnabled(false);
      return { ok: true };
    } catch (err) {
      if (import.meta.env.DEV) console.error("Push unsubscribe error:", err);
      return { ok: false, code: "server-error" };
    }
  }, [supported, user]);

  /**
   * Fire a test push to the current user's registered subscriptions.
   * Useful as a confidence check after enabling — solves "I don't
   * know if this is actually working" without waiting for a real
   * session.
   */
  const sendTest = useCallback(async () => {
    if (!user) return { ok: false, code: "no-session" };
    try {
      const token = (await supabase.auth.getSession()).data?.session?.access_token;
      if (!token) return { ok: false, code: "no-session" };
      const resp = await fetch("/api/push-test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return { ok: false, code: "server-error" };
      const body = await resp.json().catch(() => ({}));
      if (!body?.sent) return { ok: false, code: "no-subscription" };
      return { ok: true };
    } catch (err) {
      if (import.meta.env.DEV) console.error("sendTest error:", err);
      return { ok: false, code: "server-error" };
    }
  }, [user]);

  /**
   * Update the reminder lead time (in minutes).
   */
  const setReminderMinutes = useCallback(
    async (minutes) => {
      if (!user) return;
      setReminderMinutesState(minutes);
      await supabase.from("notification_preferences").upsert(
        {
          user_id: user.id,
          reminder_minutes: minutes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    },
    [user]
  );

  return {
    supported,
    permission,
    enabled,
    reminderMinutes,
    loading,
    needsInstall,
    reconciledOff,
    clearReconciliationMessage,
    enable,
    disable,
    sendTest,
    setReminderMinutes,
  };
}
