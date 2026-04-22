/* ── POST /api/push-test ──
   Send a test push to every subscription the authenticated user has
   registered. Used from Settings so users can verify their setup
   without waiting for a real session reminder. Drops expired rows
   (410 / 404 from the push provider) just like the cron endpoint. */

import { getServiceClient, sendPush, TERMINAL_PUSH_STATUSES } from "./_push.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
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
      return res.status(500).json({ error: "Failed to read subscriptions", detail: subErr.message });
    }
    if (!subs || subs.length === 0) {
      return res.status(200).json({ sent: 0, staleRemoved: 0, results: [] });
    }

    const payload = {
      title: "Cardigan",
      body: "Las notificaciones están configuradas correctamente.",
      url: "/",
    };

    let sent = 0;
    let staleRemoved = 0;
    const results = [];
    for (const sub of subs) {
      const host = (() => { try { return new URL(sub.endpoint).host; } catch { return "?"; } })();
      try {
        await sendPush(sub, payload);
        sent++;
        results.push({ host, ok: true });
      } catch (err) {
        // Log everything we possibly can — both structured (for log
        // aggregators) and loose (so a human scanning Vercel logs can
        // spot it immediately).
        console.error(JSON.stringify({
          evt: "push-test.send.error",
          host,
          statusCode: err?.statusCode ?? null,
          name: err?.name ?? null,
          message: err?.message ?? String(err),
          body: err?.body ?? null,
          stack: err?.stack?.split("\n").slice(0, 5).join(" | ") ?? null,
        }));
        console.error("push-test send error raw:", err);

        if (TERMINAL_PUSH_STATUSES.has(err?.statusCode)) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint);
          staleRemoved++;
          results.push({ host, ok: false, terminal: true, statusCode: err.statusCode, message: err.message });
        } else {
          results.push({
            host,
            ok: false,
            terminal: false,
            statusCode: err?.statusCode ?? null,
            name: err?.name ?? null,
            message: err?.message ?? String(err),
            body: err?.body ?? null,
          });
        }
      }
    }

    return res.status(200).json({ sent, staleRemoved, results });
  } catch (err) {
    console.error("push-test HANDLER crashed:", err);
    return res.status(500).json({
      error: "Handler exception",
      name: err?.name ?? null,
      message: err?.message ?? String(err),
      stack: err?.stack?.split("\n").slice(0, 5).join(" | ") ?? null,
    });
  }
}
