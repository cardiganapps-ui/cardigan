/* ── POST /api/__push-probe ──
   TEMPORARY diagnostic. Guarded by CRON_SECRET so it's not public.
   Reads VAPID config from process.env exactly like send-session-reminders
   does, then attempts a webpush.sendNotification on the named user's
   latest subscription. Returns the full outcome (success code, error
   detail, VAPID prefixes) so we can compare server behavior to a known-
   good CLI call using the same keypair.

   Delete this file once diagnosed. */

import webpush from "web-push";
import { getServiceClient, readVapidConfig } from "./_push.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== process.env.CRON_SECRET) return res.status(401).json({ error: "nope" });

  const { subject, pub, priv, missing } = readVapidConfig();
  const envReport = {
    subject,
    pubLength: pub?.length || 0,
    pubPrefix: pub?.slice(0, 12) || null,
    pubSuffix: pub?.slice(-8) || null,
    privLength: priv?.length || 0,
    privPrefix: priv?.slice(0, 6) || null,
    privSuffix: priv?.slice(-4) || null,
    missing,
    VAPID_SUBJECT_raw: process.env.VAPID_SUBJECT || null,
    VAPID_EMAIL_raw: process.env.VAPID_EMAIL || null,
    VAPID_PUBLIC_KEY_prefix: (process.env.VAPID_PUBLIC_KEY || "").slice(0, 12),
    VITE_VAPID_PUBLIC_KEY_prefix: (process.env.VITE_VAPID_PUBLIC_KEY || "").slice(0, 12),
    VAPID_PRIVATE_KEY_prefix: (process.env.VAPID_PRIVATE_KEY || "").slice(0, 6),
  };

  if (missing.length) return res.status(200).json({ env: envReport, error: "env missing" });

  try {
    webpush.setVapidDetails(subject, pub, priv);
  } catch (err) {
    return res.status(200).json({ env: envReport, stage: "setVapidDetails", error: err?.message });
  }

  const supabase = getServiceClient();
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth, user_id, created_at")
    .eq("user_id", "4fae2197-1a88-4cdc-8fa6-ccc243338c1f")
    .order("created_at", { ascending: false })
    .limit(1);

  if (!subs || subs.length === 0) return res.status(200).json({ env: envReport, error: "no sub" });

  const sub = subs[0];
  try {
    const r = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title: "Probe", body: "from serverless", url: "/" })
    );
    return res.status(200).json({ env: envReport, result: "ok", statusCode: r.statusCode });
  } catch (err) {
    return res.status(200).json({
      env: envReport,
      result: "fail",
      statusCode: err?.statusCode ?? null,
      name: err?.name ?? null,
      message: err?.message ?? String(err),
      body: err?.body ?? null,
    });
  }
}
