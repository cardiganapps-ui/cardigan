import { getAuthUser } from "./_r2.js";
import { getServiceClient } from "./_push.js";
import { withSentry } from "./_sentry.js";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { endpoint } = req.body || {};
    if (!endpoint || typeof endpoint !== "string") {
      return res.status(400).json({ error: "Invalid endpoint" });
    }

    const supabase = getServiceClient();

    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("user_id", user.id);

    if (error) {
      return res.status(500).json({ error: "Failed to remove subscription" });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("push-unsubscribe error:", err);
    res.status(500).json({ error: "Unsubscribe failed" });
  }
}

export default withSentry(handler, { name: "push-unsubscribe" });
