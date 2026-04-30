/* ── Per-endpoint rate limiter ────────────────────────────────────────
   Sliding-window counter backed by the `rate_limits` Postgres table.
   Use inside any /api/* handler that hits an external paid service or
   does meaningful DB work — the Vercel Firewall global cap (120/min/IP)
   is too coarse to protect those.

   Usage:
     const rl = await rateLimit({ endpoint: "stripe-checkout",
       bucket: user.id, max: 5, windowSec: 60 });
     if (!rl.ok) {
       res.setHeader("Retry-After", String(rl.retryAfter));
       return res.status(429).json({ error: "Too many requests" });
     }

   Best-effort by design: a DB hiccup returns ok:true so a brief
   Postgres outage doesn't block legitimate users. The 120/min/IP at
   Vercel is the absolute backstop.

   Pruning: a daily cron in send-session-reminders.js purges rows
   older than the largest window we use (default ~24h). */

import { getServiceClient } from "./_admin.js";

export async function rateLimit({ endpoint, bucket, max, windowSec }) {
  if (!endpoint || !bucket) {
    // Misconfigured caller — fail open (better than fail closed in a
    // hot path). The Sentry wrapper around the handler will see the
    // wrapping route name in any error metadata.
    return { ok: true, remaining: null, retryAfter: 0 };
  }
  const svc = getServiceClient();
  const now = Date.now();
  const windowStart = new Date(now - windowSec * 1000).toISOString();

  // Count hits in the sliding window. We do this BEFORE inserting the
  // current attempt so the limit acts as "max in the previous N
  // seconds", not "max+1 because we counted ourselves".
  const { count, error: countError } = await svc
    .from("rate_limits")
    .select("hit_at", { count: "exact", head: true })
    .eq("endpoint", endpoint)
    .eq("bucket", bucket)
    .gte("hit_at", windowStart);
  if (countError) {
    // DB read failed — fail open. Errors are surfaced via the
    // server logs; we don't 500 the user-visible request.
    console.warn("rateLimit count failed:", countError.message);
    return { ok: true, remaining: null, retryAfter: 0 };
  }

  if ((count ?? 0) >= max) {
    return { ok: false, remaining: 0, retryAfter: windowSec };
  }

  // Record the hit. Race-safe enough — if two concurrent calls land in
  // the same window, both insert (separate hit_at), and the next call
  // sees both. The composite primary key prevents duplicates only in
  // the rare microsecond-collision case.
  const { error: insertError } = await svc
    .from("rate_limits")
    .insert({
      endpoint,
      bucket,
      hit_at: new Date(now).toISOString(),
    });
  if (insertError) {
    // Insert failed — log but allow. The limiter is best-effort.
    console.warn("rateLimit insert failed:", insertError.message);
  }
  return { ok: true, remaining: max - (count ?? 0) - 1, retryAfter: 0 };
}

/* Caller for IP-based limits when there's no authed user (the Stripe
   webhook itself can't be rate-limited like this — Stripe's IPs would
   trip it). For authed endpoints, prefer bucket = user.id. */
export function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}
