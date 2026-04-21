/* ── POST /api/push-test ──
   Send a test push to every subscription the authenticated user has
   registered. Used from Settings so users can verify their setup
   without waiting for a real session reminder. Drops expired rows
   (410 / 404 from the push provider) just like the cron endpoint. */

import { getServiceClient, sendPush, TERMINAL_PUSH_STATUSES } from "./_push.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Verify the caller's JWT before using the service-role client.
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Missing bearer token" });

  const supabase = getServiceClient();
  const { data: userData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !userData?.user) return res.status(401).json({ error: "Invalid session" });
  const userId = userData.user.id;

  const { data: subs, error: subErr } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (subErr) {
    console.error("push-test fetch failed:", subErr.message);
    return res.status(500).json({ error: "Failed to read subscriptions" });
  }
  if (!subs || subs.length === 0) {
    return res.status(200).json({ sent: 0, staleRemoved: 0 });
  }

  const payload = {
    title: "Cardigan",
    body: "Las notificaciones están configuradas correctamente.",
    url: "/",
  };

  let sent = 0;
  let staleRemoved = 0;
  for (const sub of subs) {
    try {
      await sendPush(sub, payload);
      sent++;
    } catch (err) {
      if (TERMINAL_PUSH_STATUSES.has(err.statusCode)) {
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", sub.endpoint);
        staleRemoved++;
      } else {
        console.error("push-test send error:", err.statusCode, err.message);
      }
    }
  }

  return res.status(200).json({ sent, staleRemoved });
}
