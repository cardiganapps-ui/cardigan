/* ── Shared helpers for push notification API routes ── */

import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// Short month names matching src/utils/dates.js
const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

export function formatShortDate(date: Date): string {
  return `${date.getDate()}-${SHORT_MONTHS[date.getMonth()]}`;
}

// Legacy space-separated form. Still present in historical DB rows until the
// 008_date_format_hyphens migration normalizes them. The cron matches both.
export function formatShortDateLegacy(date: Date): string {
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
}

export function getServiceClient(): Row {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing: string[] = [];
  if (!url || !url.trim()) missing.push("SUPABASE_URL");
  if (!key || !key.trim()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    throw new Error(`Missing env var(s): ${missing.join(", ")}`);
  }
  return createClient(url!.trim(), key!.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Push-provider response codes that indicate the subscription is
// permanently unusable. Callers drop these rows so they don't keep
// erroring every 5 minutes.
//   410 Gone         — browser revoked the subscription
//   404 Not Found    — endpoint forgotten by the push service
//   400 Bad Request  — malformed p256dh/auth; can't recover
// 403 is intentionally NOT included: FCM has been observed to return it
// transiently during VAPID key propagation windows. Keep it loud (log)
// but don't drop the row.
export const TERMINAL_PUSH_STATUSES = new Set([400, 404, 410]);

// Subscriptions must point at one of the real push service backends a
// browser would ever assign. The /api/push-resubscribe endpoint is
// unauthenticated (auth is the opaque token), so this allowlist is the
// belt-and-suspenders defense against redirecting a rotated row at an
// attacker-controlled URL if a (endpoint, token) pair ever leaks.
const ALLOWED_PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "web.push.apple.com",
  "updates.push.services.mozilla.com",
  "wns.windows.com",
  "push.services.mozilla.com",
  "notify.windows.com",
]);

export function isAllowedPushEndpoint(urlString: Row): boolean {
  try {
    const u = new URL(urlString);
    if (u.protocol !== "https:") return false;
    // Allow exact match or subdomains of the big-two regional pushers
    // (e.g. china.push.apple.com, asia.web.push.apple.com) — Apple and
    // Google have used several regional hosts over the years.
    if (ALLOWED_PUSH_HOSTS.has(u.host)) return true;
    return (
      u.host.endsWith(".push.apple.com") ||
      u.host.endsWith(".googleapis.com") ||
      u.host.endsWith(".push.services.mozilla.com")
    );
  } catch {
    return false;
  }
}

// web-push 3.6.7 strictly requires URL-safe base64 without padding
// (regex [A-Za-z0-9\-_]+). A value stored with trailing "=" padding
// or with standard "+/" chars throws "Vapid public key must be a URL
// safe Base 64 (without '=')" BEFORE the HTTP call is attempted — which
// silently broke every push send in the background until now. Both
// forms represent the same binary key, so normalising is safe.
function toUrlSafeBase64(s: Row): Row {
  if (!s || typeof s !== "string") return s;
  return s.trim().replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Prefer the canonical names (VAPID_PUBLIC_KEY, VAPID_SUBJECT). During
// the migration away from the historical VITE_/EMAIL names we still
// accept those as fallbacks so the transition can happen without a
// key rotation — the legacy names were set by an older .env.example.
// If the subject is missing or malformed we fall back to a real mailto
// instead of throwing: webpush's own validator handles it, and throwing
// here would collapse to "sent=0" at call sites without a usable error.
export function readVapidConfig(): Row {
  // Trim to defend against a trailing "\n" paste into the Vercel env
  // editor — web-push embeds the subject into the VAPID JWT "sub" claim
  // verbatim, and Apple's push gateway rejects any JWT whose "sub"
  // contains a newline with {"reason":"BadJwtToken"} → 403. Lost ~2h
  // this session chasing that, worth the explicit .trim().
  const rawSubject = (process.env.VAPID_SUBJECT || process.env.VAPID_EMAIL || "").trim();
  const subject = rawSubject && (rawSubject.startsWith("mailto:") || rawSubject.startsWith("https:"))
    ? rawSubject
    : "mailto:noreply@cardigan.mx";
  const pub = toUrlSafeBase64(process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY);
  const priv = toUrlSafeBase64(process.env.VAPID_PRIVATE_KEY);
  const missing: string[] = [];
  if (!pub) missing.push("VAPID_PUBLIC_KEY");
  if (!priv) missing.push("VAPID_PRIVATE_KEY");
  return { subject, pub, priv, missing };
}

export function sendPush(subscription: Row, payload: Row): Promise<Row> {
  const { subject, pub, priv, missing } = readVapidConfig();
  if (missing.length) {
    throw new Error(`Missing or invalid VAPID env var(s): ${missing.join(", ")}`);
  }
  webpush.setVapidDetails(subject, pub, priv);
  return webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    JSON.stringify(payload)
  );
}

export function verifyCronSecret(req: Row): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.authorization;
  return auth === `Bearer ${secret}`;
}

// Non-session pushes (referral nudges, lifecycle prompts) MUST respect
// the user's local hour. 10:00–19:00 is the polite window across MX —
// avoids buzzing a phone at 6am or during therapy hours later in the
// evening. Session reminders are intentionally NOT gated by this:
// they're tied to a session the user themselves scheduled, so the
// hour-of-day is meaningful.
//
// Returns true if `now` (defaulting to current time) is OUTSIDE the
// 10:00–19:00 local window for the given IANA zone. Defaults to
// America/Mexico_City when zone is missing/invalid (matches the
// app-wide default in notification_preferences).
export function isInQuietHours(tz: Row, now = new Date()): boolean {
  const zone = tz || "America/Mexico_City";
  let hour: number;
  try {
    const local = new Date(now.toLocaleString("en-US", { timeZone: zone }));
    hour = local.getHours();
  } catch {
    // Bad TZ value — fall back to MX as if the user had no preference
    // set. Better than emitting at a random UTC hour.
    const local = new Date(now.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
    hour = local.getHours();
  }
  return hour < 10 || hour >= 19;
}
