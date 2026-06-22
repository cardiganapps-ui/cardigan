import crypto from "node:crypto";
import { getAuthUser } from "./_r2.js";
import { getServiceClient } from "./_push.js";
import { withSentry } from "./_sentry.js";
import { rateLimit } from "./_ratelimit.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// Accepts EITHER of two shapes:
//
//   Web Push (existing):
//     { subscription: { endpoint, keys: { p256dh, auth } } }
//   Native (Phase 2.2+):
//     { platform: 'ios' | 'android', token: string }
//
// Both upsert into push_subscriptions keyed on endpoint (for native rows
// the FCM/APNs token IS the endpoint). The platform column distinguishes
// the rows so the cron's fan-out can route each to the correct send path
// (web-push for 'web', FCM for 'android', APNs for 'ios').

function parseBody(body: Row): Row {
  if (!body || typeof body !== "object") return { error: "Invalid body" };

  // Native shape
  if (body.platform || body.token) {
    const platform = body.platform;
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (platform !== "ios" && platform !== "android") {
      return { error: "Invalid platform" };
    }
    if (!token) return { error: "Missing token" };
    return {
      kind: "native",
      platform,
      endpoint: token,
      p256dh: null,
      auth: null,
    };
  }

  // Web shape
  const sub = body.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return { error: "Invalid subscription" };
  }
  return {
    kind: "web",
    platform: "web",
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
  };
}

async function handler(req: Row, res: Row) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    // 30/hour per user: a normal client subscribes once per browser
    // install + occasionally on SW upgrade. A malicious client could
    // otherwise flood push_subscriptions with thousands of rotated
    // endpoints to either bloat the table or hold upsert locks.
    const rl = await rateLimit({ endpoint: "push-subscribe", bucket: user.id, max: 30, windowSec: 3600 });
    if (!rl.ok) {
      res.setHeader("Retry-After", String(rl.retryAfter));
      return res.status(429).json({ error: "Too many requests" });
    }

    const parsed = parseBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const supabase = getServiceClient();

    // Opaque one-shot token that lets the SW re-register the subscription
    // after a browser-initiated rotation without being able to hold a JWT.
    // Only meaningful for web rows — native push doesn't have a
    // service-worker rotation flow — but harmless to mint either way and
    // keeps the response shape consistent for the client.
    const resubToken = crypto.randomBytes(32).toString("base64url");

    // Upsert push subscription (unique on endpoint). The platform +
    // shape constraints on push_subscriptions ensure web rows keep
    // p256dh/auth and native rows null them out — see
    // supabase/migrations/063_native_push_subscriptions.sql.
    const { error: subError } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          platform: parsed.platform,
          endpoint: parsed.endpoint,
          p256dh: parsed.p256dh,
          auth: parsed.auth,
          resub_token: resubToken,
        },
        { onConflict: "endpoint" }
      );

    if (subError) {
      console.error("push_subscriptions upsert error:", subError.message);
      return res.status(500).json({ error: "Failed to save subscription" });
    }

    // Ensure notification preferences row exists
    const { error: prefError } = await supabase
      .from("notification_preferences")
      .upsert(
        {
          user_id: user.id,
          enabled: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id", ignoreDuplicates: true }
      );

    if (prefError) {
      // Non-fatal: subscription was saved, preferences just didn't upsert
      console.error("notification_preferences upsert error:", prefError.message);
    }

    res.status(200).json({ ok: true, resubToken });
  } catch (err: Row) {
    console.error("push-subscribe error:", err);
    res.status(500).json({ error: "Subscription failed" });
  }
}

export default withSentry(handler, { name: "push-subscribe" });
