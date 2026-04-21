import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { putPushState, clearPushState } from "../pushStore";

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
 * POST the given PushSubscription to the server. On success, persists
 * the returned resubscribe token to IndexedDB so the service worker can
 * re-authenticate after a browser-initiated endpoint rotation. Returns
 * { ok } so call sites that only care about success stay readable.
 */
async function postSubscription(subscription) {
  const token = (await supabase.auth.getSession()).data?.session?.access_token;
  if (!token) return { ok: false };
  const resp = await fetch("/api/push-subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  if (!resp.ok) return { ok: false };
  const body = await resp.json().catch(() => ({}));
  if (body?.resubToken) {
    try {
      await putPushState({ endpoint: subscription.endpoint, resubToken: body.resubToken });
    } catch {
      // Non-fatal: SW resubscribe will fail but mount-time reconciliation
      // will re-create the sub next app open.
    }
  }
  return { ok: true };
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
  const { ok } = await postSubscription(subscription);
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
            // Browser still has a subscription. Await the server re-
            // post so the UI doesn't flash "enabled" before the row
            // actually exists — a common timing pitfall where the
            // user hits "Send test" in the first second after load
            // and the server still has stale (or no) subs.
            await postSubscription(existing);
            if (cancelled) return;
            // Trust the browser subscription — if the server re-post
            // failed (network blip), the next action self-heals.
            setEnabled(true);
          } else if (Notification.permission === "granted") {
            // Re-subscribe silently — no UI prompt when permission
            // is already granted.
            const { ok } = await subscribeAndPersist();
            if (cancelled) return;
            if (ok) setEnabled(true);
            else {
              await supabase.from("notification_preferences").upsert(
                { user_id: user.id, enabled: false, updated_at: new Date().toISOString() },
                { onConflict: "user_id" }
              );
              setEnabled(false);
              setReconciledOff(true);
            }
          } else {
            // Permission revoked at OS / browser level. Mirror in DB.
            await supabase.from("notification_preferences").upsert(
              { user_id: user.id, enabled: false, updated_at: new Date().toISOString() },
              { onConflict: "user_id" }
            );
            setEnabled(false);
            setReconciledOff(true);
          }
        } catch {
          // SW ready errored out — leave state as pref so the UI
          // doesn't thrash.
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

    const { ok: serverOk } = await postSubscription(subscription);
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

      try { await clearPushState(); } catch { /* ignore */ }
      setEnabled(false);
      return { ok: true };
    } catch (err) {
      if (import.meta.env.DEV) console.error("Push unsubscribe error:", err);
      return { ok: false, code: "server-error" };
    }
  }, [supported, user]);

  /**
   * Fire a test push to the current user's registered subscriptions.
   *
   * Pre-syncs the browser's current subscription to the server before
   * calling the test endpoint. This closes a timing race where the
   * user taps "Send test" during the first second after app load —
   * before reconciliation has finished re-posting the browser's sub
   * to the server — and gets a false "no active subscriptions"
   * response. Now the test itself guarantees the server sees the
   * live browser subscription before trying to send.
   */
  const sendTest = useCallback(async () => {
    if (!user) return { ok: false, code: "no-session" };
    if (!supported) return { ok: false, code: "unsupported" };

    // 1. Ensure the server has a current browser subscription. Best
    //    effort — if any step fails we still let the server decide,
    //    it just might return no-subscription with a cleaner message.
    try {
      const reg = await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();
      if (!subscription && Notification.permission === "granted") {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      if (subscription) {
        await postSubscription(subscription);
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error("sendTest pre-sync failed:", err);
    }

    // 2. Fire the actual test.
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
  }, [user, supported]);

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
