import crypto from "node:crypto";
import { getAuthUser } from "./_r2.js";
import { getServiceClient } from "./_push.js";
import { withSentry } from "./_sentry.js";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { subscription } = req.body || {};
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: "Invalid subscription" });
    }

    const supabase = getServiceClient();

    // Opaque one-shot token that lets the SW re-register the subscription
    // after a browser-initiated rotation without being able to hold a JWT.
    // The SW stores it in IDB; the unauthenticated /api/push-resubscribe
    // endpoint matches on (endpoint, resub_token) to authorize the swap.
    const resubToken = crypto.randomBytes(32).toString("base64url");

    // Upsert push subscription (unique on endpoint). We omit created_at
    // so the column's DEFAULT now() fires on initial insert but isn't
    // overwritten on every mount-time re-post — preserves accurate row
    // age for future TTL / cleanup sweeps.
    const { error: subError } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          resub_token: resubToken,
        },
        { onConflict: "endpoint" }
      );

    if (subError) {
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
  } catch (err) {
    console.error("push-subscribe error:", err);
    res.status(500).json({ error: "Subscription failed" });
  }
}

export default withSentry(handler, { name: "push-subscribe" });
