import { getAuthUser } from "./_r2.js";
import { getServiceClient } from "./_push.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { subscription } = req.body || {};
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: "Invalid subscription" });
    }

    const supabase = getServiceClient();

    // Upsert push subscription (unique on endpoint)
    const { error: subError } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          created_at: new Date().toISOString(),
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

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("push-subscribe error:", err);
    res.status(500).json({ error: "Subscription failed" });
  }
}
