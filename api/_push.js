/* ── Shared helpers for push notification API routes ── */

import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

// Short month names matching src/utils/dates.js
const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

export function formatShortDate(date) {
  return `${date.getDate()}-${SHORT_MONTHS[date.getMonth()]}`;
}

// Legacy space-separated form. Still present in historical DB rows until the
// 008_date_format_hyphens migration normalizes them. The cron matches both.
export function formatShortDateLegacy(date) {
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
}

export function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [];
  if (!url || !url.trim()) missing.push("SUPABASE_URL");
  if (!key || !key.trim()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    throw new Error(`Missing env var(s): ${missing.join(", ")}`);
  }
  return createClient(url.trim(), key.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Push-provider response codes that indicate the subscription is
// permanently unusable with our VAPID keys. Callers drop these rows so
// they don't keep erroring every 5 minutes.
//   410 Gone                — browser revoked the subscription
//   404 Not Found           — endpoint forgotten by the push service
//   403 Forbidden           — VAPID mismatch / key rotated underneath us
//   400 Bad Request         — malformed p256dh/auth; can't recover
export const TERMINAL_PUSH_STATUSES = new Set([400, 403, 404, 410]);

// Prefer the canonical names (VAPID_PUBLIC_KEY, VAPID_SUBJECT). During
// the migration away from the historical VITE_/EMAIL names we still
// accept those as fallbacks so the transition can happen without a
// key rotation — the legacy names were set by an older .env.example.
export function readVapidConfig() {
  const subject = process.env.VAPID_SUBJECT || process.env.VAPID_EMAIL;
  const pub = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const missing = [];
  if (!subject || !subject.startsWith("mailto:")) missing.push("VAPID_SUBJECT");
  if (!pub) missing.push("VAPID_PUBLIC_KEY");
  if (!priv) missing.push("VAPID_PRIVATE_KEY");
  return { subject, pub, priv, missing };
}

export function sendPush(subscription, payload) {
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

export function verifyCronSecret(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.authorization;
  return auth === `Bearer ${secret}`;
}
