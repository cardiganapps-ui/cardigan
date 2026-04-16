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
  const needsInstall = isIOSNotStandalone();

  // Fetch preferences + check existing subscription on mount
  useEffect(() => {
    if (!user || !supported) return;

    let cancelled = false;

    async function init() {
      // Fetch notification preferences from DB
      const { data } = await supabase
        .from("notification_preferences")
        .select("enabled, reminder_minutes")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (data) {
        setEnabled(data.enabled);
        setReminderMinutesState(data.reminder_minutes || 30);
      }

      // Sync permission state
      setPermission(Notification.permission);

      setLoading(false);
    }

    init();
    return () => { cancelled = true; };
  }, [user, supported]);

  /**
   * Request permission, subscribe to push, and persist to server.
   */
  const enable = useCallback(async () => {
    if (!supported || !user) return false;

    // 1. Request notification permission
    const perm = await Notification.requestPermission();
    setPermission(perm);
    if (perm !== "granted") return false;

    try {
      // 2. Get the service worker registration
      const reg = await navigator.serviceWorker.ready;

      // 3. Subscribe to push
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // 4. Send subscription to our API
      const token = (await supabase.auth.getSession()).data?.session?.access_token;
      const resp = await fetch("/api/push-subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      if (!resp.ok) {
        console.error("push-subscribe failed:", resp.status);
        return false;
      }

      // 5. Update preferences in DB
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
      return true;
    } catch (err) {
      console.error("Push subscription error:", err);
      return false;
    }
  }, [supported, user, reminderMinutes]);

  /**
   * Unsubscribe from push and update preferences.
   */
  const disable = useCallback(async () => {
    if (!supported || !user) return;

    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();

      if (subscription) {
        // Remove from server
        const token = (await supabase.auth.getSession()).data?.session?.access_token;
        await fetch("/api/push-unsubscribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });

        // Unsubscribe in browser
        await subscription.unsubscribe();
      }

      // Update preferences
      await supabase.from("notification_preferences").upsert(
        {
          user_id: user.id,
          enabled: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      setEnabled(false);
    } catch (err) {
      console.error("Push unsubscribe error:", err);
    }
  }, [supported, user]);

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
    enable,
    disable,
    setReminderMinutes,
  };
}
