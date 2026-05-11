// FCM (Firebase Cloud Messaging) helper — sends to Android FCM tokens
// and iOS APNs tokens via Firebase's APNs forwarding when configured.
//
// Service account credentials come from the FCM_SERVICE_ACCOUNT_JSON
// env var (the raw JSON file downloaded from Firebase Console → Project
// Settings → Service accounts). Vercel preserves newlines + escape
// characters in env var values, so we parse it directly with no base64
// dance.
//
// Returns null from getFcmApp() when the env var is missing or
// malformed — every caller is expected to fall through gracefully so
// the cron keeps delivering web push to the rest of the users.

import admin from "firebase-admin";

let _app = null;
let _initAttempted = false;

function getFcmApp() {
  if (_initAttempted) return _app;
  _initAttempted = true;

  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn("[fcm] FCM_SERVICE_ACCOUNT_JSON not set — native push delivery disabled");
    return null;
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (err) {
    console.error("[fcm] FCM_SERVICE_ACCOUNT_JSON is not valid JSON:", err.message);
    return null;
  }

  try {
    // initializeApp is global; if some other module already initialized
    // the default app this would throw "already exists." Use a named
    // instance to be safe across hot reloads + cron re-invocations.
    _app = admin.initializeApp(
      { credential: admin.credential.cert(serviceAccount) },
      "cardigan-fcm"
    );
    return _app;
  } catch (err) {
    // If a previous invocation already initialized the same named app
    // (Vercel can keep the runtime warm across requests), reuse it.
    if (err.code === "app/duplicate-app") {
      _app = admin.app("cardigan-fcm");
      return _app;
    }
    console.error("[fcm] initializeApp failed:", err.message);
    return null;
  }
}

export function fcmConfigured() {
  return !!getFcmApp();
}

/**
 * Send a single push to a single device token.
 *
 * Returns:
 *   { ok: true }
 *   { ok: false, terminal: true,  error }  — token invalid; delete the row
 *   { ok: false, terminal: false, error }  — transient; retry next cron tick
 *
 * Payload shape mirrors the existing web-push payload in _push.js so
 * the cron's existing payload-building code can be reused as-is:
 *   { title, body, url?, tag? }
 */
export async function sendFCM({ token, payload, platform }) {
  const app = getFcmApp();
  if (!app) return { ok: false, terminal: false, error: "fcm-not-configured" };
  if (!token) return { ok: false, terminal: true, error: "missing-token" };

  // Data payload must be all-string; nested objects/numbers get coerced.
  // Mirror the web-push handler in src/sw.js — title/body/url/tag are
  // the only fields the tap handler reads.
  const data = {};
  if (payload?.url) data.url = String(payload.url);
  if (payload?.tag) data.tag = String(payload.tag);

  const message = {
    token,
    notification: {
      title: payload?.title || "Cardigan",
      body: payload?.body || "",
    },
    data,
    android: {
      // Collapse repeat reminders for the same session into one banner.
      collapseKey: payload?.tag,
      notification: {
        tag: payload?.tag,
        // Default channel — the app's native code can override with a
        // dedicated "session-reminders" channel for finer-grained user
        // control; until then FCM creates a default channel on first send.
        channelId: "session_reminders",
      },
    },
    apns: {
      headers: payload?.tag ? { "apns-collapse-id": payload.tag } : undefined,
      payload: {
        aps: {
          sound: "default",
          // We don't track unread counts; the +1 nudge is a visual
          // affordance that something is waiting. Phase 3 polish can
          // replace this with a real counter from sent_reminders.
          badge: 1,
        },
      },
    },
  };

  try {
    await admin.messaging(app).send(message);
    return { ok: true };
  } catch (err) {
    // Terminal token errors → delete the push_subscriptions row so the
    // next cron tick doesn't re-attempt and burn CPU.
    const code = err?.errorInfo?.code || err?.code || "";
    const terminal =
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token" ||
      code === "messaging/invalid-argument";
    if (!terminal) {
      console.error(JSON.stringify({
        evt: "fcm.send.error",
        platform,
        code,
        message: err?.message,
      }));
    }
    return { ok: false, terminal, error: code || err?.message };
  }
}
