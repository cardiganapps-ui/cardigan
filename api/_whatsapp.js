/* ── WhatsApp Cloud API helper ──────────────────────────────────────
   Thin wrapper around the Meta Graph API for sending approved
   message templates. One exported function: `sendTemplate({...})`.

   Env vars (Vercel Production + Preview):
     WHATSAPP_ACCESS_TOKEN       — system-user permanent token
     WHATSAPP_PHONE_NUMBER_ID    — sender phone ID
     (WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_WEBHOOK_VERIFY_TOKEN,
      WHATSAPP_APP_SECRET are used by the webhook + future template
      management; not read here.)

   E.164 normalization: `patients.phone` is stored as digits-only
   (10 digits for MX). `toE164MX` prepends the +52 country code. If
   the caller passes a string that already has a "+" prefix we
   trust it as-is. */

const GRAPH_VERSION = "v20.0";

export function toE164MX(rawPhone) {
  if (!rawPhone) return null;
  const s = String(rawPhone).trim();
  if (s.startsWith("+")) return s;
  // Strip everything except digits, then assume MX if 10 digits.
  const digits = s.replace(/\D+/g, "");
  if (digits.length === 10) return `+52${digits}`;
  // 12 digits starting with 52 → already country-coded, just add the +.
  if (digits.length === 12 && digits.startsWith("52")) return `+${digits}`;
  // Anything else, return null and let the caller record a failure.
  return null;
}

function requireEnv() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const missing = [];
  if (!token || !token.trim()) missing.push("WHATSAPP_ACCESS_TOKEN");
  if (!phoneId || !phoneId.trim()) missing.push("WHATSAPP_PHONE_NUMBER_ID");
  if (missing.length) {
    throw new Error(`WhatsApp env missing: ${missing.join(", ")}`);
  }
  return { token: token.trim(), phoneId: phoneId.trim() };
}

/**
 * Send an approved template message.
 *
 * @param {object} args
 * @param {string} args.to             E.164 phone, e.g. "+5215512345678".
 * @param {string} args.templateName   e.g. "cardigan_session_reminder".
 * @param {string} args.languageCode   e.g. "es_MX".
 * @param {string[]} args.variables    body parameters in template order.
 * @returns {Promise<{ok: boolean, messageId?: string, errorCode?: string, errorReason?: string, raw?: object}>}
 */
export async function sendTemplate({ to, templateName, languageCode, variables }) {
  const { token, phoneId } = requireEnv();
  if (!to || !to.startsWith("+")) {
    return { ok: false, errorCode: "invalid_phone", errorReason: "Recipient phone must be E.164 with leading +." };
  }
  if (!Array.isArray(variables)) variables = [];

  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: variables.length > 0 ? [{
        type: "body",
        parameters: variables.map((v) => ({ type: "text", text: String(v ?? "") })),
      }] : [],
    },
  };

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneId)}/messages`;

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, errorCode: "network", errorReason: err?.message || "fetch failed" };
  }

  let json = null;
  try { json = await resp.json(); } catch { /* non-JSON response */ }

  if (!resp.ok) {
    const e = json?.error || {};
    return {
      ok: false,
      errorCode: String(e.code ?? resp.status),
      errorReason: e.message || `HTTP ${resp.status}`,
      raw: json || { httpStatus: resp.status },
    };
  }

  const messageId = json?.messages?.[0]?.id;
  return { ok: true, messageId, raw: json };
}
