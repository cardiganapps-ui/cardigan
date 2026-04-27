/* ── /api/whatsapp-webhook ─────────────────────────────────────────
   Meta Cloud API webhook endpoint. Handles two flows:

   GET  — subscription verification handshake. Meta sends
          ?hub.mode=subscribe&hub.challenge=<random>&hub.verify_token=<secret>.
          We compare the verify_token to WHATSAPP_WEBHOOK_VERIFY_TOKEN
          and echo the challenge back as plaintext on match.

   POST — delivery / read / failure callbacks. Meta signs the request
          with HMAC-SHA256 using WHATSAPP_APP_SECRET, sent in the
          X-Hub-Signature-256 header as "sha256=<hex>". We verify the
          signature against the raw body before parsing.

          Each notification can carry many statuses across many
          messages. We persist each one to `whatsapp_events` and
          update the corresponding `whatsapp_audit` row (joined by
          the Meta message_id) to the latest status. */

import crypto from "crypto";
import { Buffer } from "buffer";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";

export const config = { api: { bodyParser: false } };

// Drop signed payloads whose newest status is older than this. Generous
// window: Meta retries failed deliveries for ~24h, and we don't want to
// reject genuine retries. This is a backstop against the captured-and-
// replayed-much-later case, not a per-event freshness check.
const MAX_EVENT_AGE_SEC = 24 * 60 * 60;

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function verifyMetaSignature(rawBody, headerVal, appSecret) {
  if (!headerVal || !headerVal.startsWith("sha256=")) return false;
  const provided = headerVal.slice("sha256=".length).trim();
  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

async function handleVerify(req, res) {
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) {
    console.error("whatsapp-webhook: WHATSAPP_WEBHOOK_VERIFY_TOKEN not set");
    return res.status(500).json({ error: "Verify token not configured" });
  }
  const mode = req.query?.["hub.mode"];
  const token = req.query?.["hub.verify_token"];
  const challenge = req.query?.["hub.challenge"];
  if (mode === "subscribe" && token === verifyToken && typeof challenge === "string") {
    res.setHeader("Content-Type", "text/plain");
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ error: "Forbidden" });
}

async function handleEvent(req, res) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.error("whatsapp-webhook: WHATSAPP_APP_SECRET not set");
    return res.status(500).json({ error: "App secret not configured" });
  }
  const sig = req.headers["x-hub-signature-256"];
  if (!sig) return res.status(400).json({ error: "Missing signature" });

  const rawBody = await readRawBody(req);
  if (!verifyMetaSignature(rawBody, sig, appSecret)) {
    console.error("whatsapp-webhook: signature verification failed");
    return res.status(401).json({ error: "Invalid signature" });
  }

  let body;
  try { body = JSON.parse(rawBody); } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  // Walk entry[].changes[].value.statuses[]. Errors can appear in two
  // shapes: top-level errors[] on the value, or per-status errors[].
  // We persist whatever we find and update the audit row to "failed"
  // when an error is present.
  const statuses = [];
  for (const entry of (body?.entry || [])) {
    for (const change of (entry?.changes || [])) {
      const v = change?.value || {};
      for (const s of (v.statuses || [])) statuses.push(s);
    }
  }

  // Replay-window guard. Meta puts a unix-seconds timestamp on every
  // status; if EVERY status in this batch is more than MAX_EVENT_AGE_SEC
  // old, treat the whole request as a replay attempt and drop it.
  // (Dedup via meta_message_id catches the same payload arriving twice
  // with the same hash; this catches the meaningful case — an attacker
  // who captured one signed payload and is replaying it days later.)
  const nowSec = Math.floor(Date.now() / 1000);
  const tooOld = (s) => {
    const t = parseInt(s?.timestamp, 10);
    return Number.isFinite(t) && (nowSec - t) > MAX_EVENT_AGE_SEC;
  };
  if (statuses.length > 0 && statuses.every(tooOld)) {
    console.warn("whatsapp-webhook: dropping batch — all events older than replay window");
    return res.status(401).json({ error: "Event too old" });
  }

  if (statuses.length === 0) {
    // Could be an inbound message or a non-status notification. Log
    // for visibility but don't error out — Meta retries 4xx/5xx.
    console.log(JSON.stringify({ evt: "whatsapp.webhook.no_statuses", raw: body }));
    return res.status(200).json({ ok: true, processed: 0 });
  }

  let svc;
  try { svc = getServiceClient(); }
  catch (err) {
    console.error("whatsapp-webhook: service client unavailable:", err?.message);
    // Return 200 anyway so Meta doesn't keep retrying — we already logged.
    return res.status(200).json({ ok: true, processed: 0 });
  }

  let processed = 0;
  for (const st of statuses) {
    const messageId = st.id || null;
    const eventType = st.status || null; // sent | delivered | read | failed
    const recipient = st.recipient_id ? `+${st.recipient_id}` : null;
    const errorObj = Array.isArray(st.errors) && st.errors.length ? st.errors[0] : null;

    // 1) Always log the raw event row (admin-only readable table).
    try {
      await svc.from("whatsapp_events").insert({
        meta_message_id: messageId,
        event_type: eventType,
        recipient_phone: recipient,
        raw: st,
      });
    } catch (err) {
      console.warn("whatsapp-webhook events insert failed:", err?.message);
    }

    // 2) Update the matching audit row (joined by meta_message_id).
    if (messageId) {
      const update = {
        status: errorObj ? "failed" : eventType,
        updated_at: new Date().toISOString(),
      };
      if (errorObj) {
        update.error_code = String(errorObj.code ?? "");
        update.error_reason = errorObj.title || errorObj.message || "WhatsApp error";
      }
      try {
        await svc.from("whatsapp_audit")
          .update(update)
          .eq("meta_message_id", messageId);
      } catch (err) {
        console.warn("whatsapp-webhook audit update failed:", err?.message);
      }
    }
    processed++;
  }

  console.log(JSON.stringify({ evt: "whatsapp.webhook", processed }));
  return res.status(200).json({ ok: true, processed });
}

async function handler(req, res) {
  if (req.method === "GET") return handleVerify(req, res);
  if (req.method === "POST") return handleEvent(req, res);
  return res.status(405).json({ error: "Method not allowed" });
}

export default withSentry(handler, { name: "whatsapp-webhook" });
