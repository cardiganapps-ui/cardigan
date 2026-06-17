// Native push registration via the Capacitor PushNotifications plugin.
//
// The plugin's flow is listener-based: you register, then a separate
// 'registration' event fires asynchronously with the FCM (Android) /
// APNs (iOS) device token. We wrap that in a single subscribeNative()
// promise so the calling hook (useNotifications) can await it like the
// web-push path.
//
// All exports are no-ops on web — callers must gate on isNative() first.
// We keep them safe-to-call from a web context anyway so a missing guard
// doesn't crash the app.

import { isNative, getPlatform } from "./platform";

let listenersAttached = false;

// One-time foreground/tap listeners. PushNotifications.addListener is
// idempotent at the plugin level, but the wrapper module is loaded
// once per page mount and we don't want to stack handlers across
// hot-reloads in dev.
async function attachLifecycleListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  const { PushNotifications } = await import("@capacitor/push-notifications");

  // Foreground delivery — the OS doesn't display the notification
  // banner automatically when the app is in the foreground. Bridge to
  // the in-app toast via a CustomEvent so App.jsx (where showToast is
  // owned) can render it without coupling this module to React.
  await PushNotifications.addListener("pushNotificationReceived", (notification) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("cardigan-native-push-received", {
      detail: {
        title: notification?.title || "",
        body: notification?.body || "",
        data: notification?.data || {},
      },
    }));
  });

  // User tapped a notification. The payload's `data.url` (set
  // server-side, mirrors the web sw.js handler) tells us where in the
  // app to navigate. Hash-based routing means `location.hash = url`
  // is enough to trigger navigation.
  await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const url = action?.notification?.data?.url;
    if (url && typeof window !== "undefined") {
      // The data.url shape today is a hash route like "#agenda" or
      // a same-origin path. Either way, assigning to location is
      // safe — the app's hash-router intercepts both.
      try { window.location.assign(url); } catch { /* ignore */ }
    }
  });
}

/**
 * Check current OS notification permission for the native app.
 * Returns 'granted' | 'denied' | 'prompt' to match the web
 * Notification.permission shape (where 'default' becomes 'prompt').
 */
export async function checkNativePermission() {
  if (!isNative()) return "prompt";
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const { receive } = await PushNotifications.checkPermissions();
    if (receive === "granted") return "granted";
    if (receive === "denied") return "denied";
    return "prompt";
  } catch (err) {
    if (import.meta.env?.DEV) console.error("[nativePush] checkPermissions failed:", err);
    return "prompt";
  }
}

/**
 * Request permission and register for native push. Resolves with the
 * device token (FCM on Android, APNs on iOS) or a typed error.
 *
 * Return shape mirrors the web enable() path for symmetry:
 *   { ok: true,  platform: 'ios'|'android', token: string }
 *   { ok: false, code: 'unsupported' | 'permission-denied' | 'register-failed' }
 */
export async function subscribeNative() {
  if (!isNative()) return { ok: false, code: "unsupported" };

  const platform = getPlatform(); // 'ios' | 'android'
  let PushNotifications;
  try {
    ({ PushNotifications } = await import("@capacitor/push-notifications"));
  } catch {
    return { ok: false, code: "unsupported" };
  }

  // Lifecycle listeners are independent of the registration listener;
  // attach them once so foreground notifications + taps always route
  // correctly, even if the user enables/disables push multiple times.
  await attachLifecycleListeners().catch(() => {});

  // Permission. checkPermissions reads the current value without
  // prompting the user; requestPermissions shows the OS dialog if the
  // current state is 'prompt'. iOS returns 'denied' permanently after
  // the user taps "Don't Allow" — we surface that distinctly so the
  // caller can prompt the user to open Settings.
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive !== "granted") {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== "granted") {
    return { ok: false, code: "permission-denied" };
  }

  // Register, then await the listener that fires with the token. The
  // listener is one-shot for this call — we detach it once we have the
  // value to avoid resolving twice if the OS re-issues the token mid-
  // session.
  return await new Promise((resolve) => {
    let regHandle, errHandle;
    let settled = false;

    const cleanup = () => {
      try { regHandle?.remove?.(); } catch { /* ignore */ }
      try { errHandle?.remove?.(); } catch { /* ignore */ }
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    // Belt-and-braces timeout — if for any reason neither the success
    // nor the error listener fires (plugin glitch, OS denying silently),
    // don't leave the caller hanging.
    const timeout = setTimeout(() => {
      finish({ ok: false, code: "register-failed", error: "no registration event within 15s" });
    }, 15000);

    Promise.all([
      PushNotifications.addListener("registration", (token) => {
        clearTimeout(timeout);
        finish({ ok: true, platform, token: token.value });
      }),
      PushNotifications.addListener("registrationError", (err) => {
        clearTimeout(timeout);
        if (import.meta.env?.DEV) console.error("[nativePush] registration error:", err);
        finish({ ok: false, code: "register-failed", error: (err && (err.error || err.message)) || JSON.stringify(err || {}).slice(0, 180) });
      }),
    ])
      .then(([r, e]) => { regHandle = r; errHandle = e; })
      .then(() => PushNotifications.register())
      .catch((err) => {
        clearTimeout(timeout);
        if (import.meta.env?.DEV) console.error("[nativePush] register threw:", err);
        finish({ ok: false, code: "register-failed", error: err?.message || "register() threw" });
      });
  });
}
