/* ── POST /api/push-resubscribe ──
   Replaces an existing push subscription row with a freshly-created one
   after the browser rotates its endpoint. Called by the service worker's
   `pushsubscriptionchange` handler, which cannot carry a Supabase JWT.

   Authorization is the (oldEndpoint, resubToken) pair: both must match
   an existing row. The token was issued at subscribe-time, stored in
   IndexedDB by the client, and is single-use — the endpoint rotates a
   fresh token in the same transaction as the swap so a leaked token
   can't be replayed.

   Body: { oldEndpoint, resubToken, subscription: { endpoint, keys: { p256dh, auth } } }
   Response: { ok: true, resubToken: <newToken> } on success, 404 on mismatch. */

import crypto from "node:crypto";
import { getServiceClient } from "./_push.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { oldEndpoint, resubToken, subscription } = req.body || {};
  if (
    typeof oldEndpoint !== "string" || !oldEndpoint ||
    typeof resubToken !== "string" || !resubToken ||
    !subscription?.endpoint ||
    !subscription?.keys?.p256dh ||
    !subscription?.keys?.auth
  ) {
    return res.status(400).json({ error: "Invalid body" });
  }

  const supabase = getServiceClient();

  // Generic 404 on any mismatch so callers can't probe whether a given
  // endpoint exists separately from whether the token matches.
  const { data: existing, error: selErr } = await supabase
    .from("push_subscriptions")
    .select("id, user_id")
    .eq("endpoint", oldEndpoint)
    .eq("resub_token", resubToken)
    .maybeSingle();

  if (selErr) {
    console.error("push-resubscribe lookup failed:", selErr.message);
    return res.status(500).json({ error: "Lookup failed" });
  }
  if (!existing) return res.status(404).json({ error: "Unknown subscription" });

  const newToken = crypto.randomBytes(32).toString("base64url");

  // Single-statement swap. The WHERE clause still matches on both old
  // endpoint and old token so a concurrent second call can't race and
  // overwrite the already-rotated row.
  const { error: updErr } = await supabase
    .from("push_subscriptions")
    .update({
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      resub_token: newToken,
      created_at: new Date().toISOString(),
    })
    .eq("endpoint", oldEndpoint)
    .eq("resub_token", resubToken);

  if (updErr) {
    // Likely a uniqueness clash on endpoint — the push provider assigned
    // a new endpoint that we already have another row for. The caller
    // will fall back to mount-time reconciliation on next app open.
    console.error("push-resubscribe swap failed:", updErr.message);
    return res.status(409).json({ error: "Swap failed" });
  }

  console.log(JSON.stringify({
    evt: "push.resubscribe",
    user_id: existing.user_id,
    endpoint_host_old: safeHost(oldEndpoint),
    endpoint_host_new: safeHost(subscription.endpoint),
  }));

  return res.status(200).json({ ok: true, resubToken: newToken });
}

function safeHost(u) {
  try { return new URL(u).host; } catch { return "?"; }
}
