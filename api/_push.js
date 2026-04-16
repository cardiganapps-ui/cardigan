/* ── Shared helpers for push notification API routes ── */

import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

// Short month names matching src/utils/dates.js
const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

export function formatShortDate(date) {
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

export function sendPush(subscription, payload) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || "mailto:noreply@example.com",
    process.env.VITE_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

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
