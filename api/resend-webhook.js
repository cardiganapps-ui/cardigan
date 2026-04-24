/* ── POST /api/resend-webhook ──
   Ingests email event webhooks from Resend (sent / delivered / bounced /
   delayed / complained / opened / clicked). Purpose: measure real
   send→delivered times so when a user reports "verification email took
   too long," we can tell whether the gap was in Resend's relay or in
   the recipient's anti-spam hold.

   Security: Resend signs each delivery with Svix-style HMAC-SHA256.
   We verify the signature against RESEND_WEBHOOK_SECRET; unsigned or
   malformed requests are dropped with 401.

   Storage: events are logged as structured JSON (captured by Vercel
   logs, ~1-7 day retention depending on plan) and additionally
   persisted to the `resend_events` table for longer-term analysis.
   The DB insert is best-effort — if the table doesn't exist yet we
   log and return 200 so Resend doesn't mark the endpoint as failing. */

import crypto from "crypto";
import { Buffer } from "buffer";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";

// Vercel normally JSON-parses the body, but Svix signing requires the
// raw bytes (byte-for-byte what Resend signed). Disabling the parser
// lets us read the raw stream and verify before doing anything else.
export const config = { api: { bodyParser: false } };

const MAX_TIMESTAMP_SKEW_SEC = 5 * 60;

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function verifySvix({ body, id, timestamp, signature, secret }) {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedPayload = `${id}.${timestamp}.${body}`;
  const expected = crypto
    .createHmac("sha256", secretBytes)
    .update(signedPayload)
    .digest("base64");
  // Svix sends multiple signatures space-separated; any one matching
  // passes. Prefix is "v1," which we strip before comparing.
  const received = signature.split(" ").map(part => part.replace(/^v1,/, ""));
  return received.some(sig => {
    try {
      const a = Buffer.from(sig, "base64");
      const b = Buffer.from(expected, "base64");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("resend-webhook: RESEND_WEBHOOK_SECRET not set");
    return res.status(500).json({ error: "Webhook secret not configured" });
  }

  const svixId = req.headers["svix-id"];
  const svixTimestamp = req.headers["svix-timestamp"];
  const svixSignature = req.headers["svix-signature"];
  if (!svixId || !svixTimestamp || !svixSignature) {
    return res.status(400).json({ error: "Missing signature headers" });
  }

  const timestamp = parseInt(svixTimestamp, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp) || Math.abs(nowSec - timestamp) > MAX_TIMESTAMP_SKEW_SEC) {
    return res.status(401).json({ error: "Timestamp out of tolerance" });
  }

  const rawBody = await readRawBody(req);
  const ok = verifySvix({
    body: rawBody,
    id: svixId,
    timestamp: svixTimestamp,
    signature: svixSignature,
    secret,
  });
  if (!ok) {
    console.error("resend-webhook: signature verification failed");
    return res.status(401).json({ error: "Invalid signature" });
  }

  let event;
  try { event = JSON.parse(rawBody); } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const type = event.type;
  const eventAt = event.created_at;
  const data = event.data || {};
  const emailId = data.email_id || null;
  const to = Array.isArray(data.to) ? data.to.join(",") : String(data.to || "");
  const subject = data.subject || null;
  const emailCreatedAt = data.created_at || null;

  // Seconds since Resend accepted the email — the most useful diagnostic
  // number. For `email.delivered` this is the end-to-end time; for
  // intermediate events (sent, delayed) it's how far into the flow we
  // are when the event fired.
  const secondsSinceSend = emailCreatedAt && eventAt
    ? (new Date(eventAt).getTime() - new Date(emailCreatedAt).getTime()) / 1000
    : null;

  console.log(JSON.stringify({
    evt: "resend.webhook",
    type,
    email_id: emailId,
    to,
    subject,
    event_at: eventAt,
    email_created_at: emailCreatedAt,
    seconds_since_send: secondsSinceSend,
  }));

  // Best-effort DB persistence. The service-role client bypasses RLS so
  // the row lands regardless of whoever sent the original email. If the
  // table is missing we swallow the error — the console log above is
  // already a usable record.
  try {
    const supabase = getServiceClient();
    const { error } = await supabase.from("resend_events").insert({
      email_id: emailId,
      type,
      event_at: eventAt,
      email_created_at: emailCreatedAt,
      to_addr: to,
      subject,
      seconds_since_send: secondsSinceSend,
      raw: event,
    });
    if (error) console.warn("resend-webhook db error:", error.message);
  } catch (err) {
    console.warn("resend-webhook db exception:", err.message);
  }

  return res.status(200).json({ ok: true });
}

export default withSentry(handler, { name: "resend-webhook" });
