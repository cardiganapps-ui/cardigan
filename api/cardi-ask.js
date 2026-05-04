/* POST /api/cardi-ask
   Cardi — in-app navigation/help chatbot. Pure Q&A with Claude Haiku
   over a static system prompt that maps the Cardigan app. NO patient
   data is read or sent. Server-side Pro gate mirrors the client check
   so a bypassed UI can't backdoor the endpoint.

   Request:
     { messages: [{ role: "user"|"assistant", content: string }, ...],
       context: { profession?, screen?, accessState?, patientCount?, sessionCount? } }

   Response (200):
     { answer: string, usage: { ... } }

   Errors: 401 (no JWT), 403 (not Pro, with action:"subscribe"),
   413 (input too large), 422 (PII detected),
   429 (rate limited), 503 (paused via Edge Config), 502 (Anthropic
   error). All wrapped by withSentry. */

import Anthropic from "@anthropic-ai/sdk";
import { getAuthUser } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import { getFlag } from "./_flags.js";
import { rateLimit } from "./_ratelimit.js";
import { isProUser } from "./_subscription.js";
import { CARDI_SYSTEM_PROMPT, buildCardiContext } from "../src/data/cardiKnowledge.js";

// Per-message and per-request bounds. Generous enough for normal use,
// tight enough to keep cost predictable and reject pasted PII attempts.
const MAX_MESSAGES = 20;
const MAX_CONTENT_CHARS = 2000;
const MAX_TOTAL_CHARS = 12000;

// Soft PII detector for the latest user input. Catches obvious cases
// without false-positiving on legitimate questions. NOT a security
// boundary — Cardi is also instructed in its system prompt to refuse
// PII; this is belt-and-suspenders.
const PHONE_RE = /\b\d{10}\b/;                          // bare 10-digit MX phone
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/;        // any email-shaped token
function looksLikePII(text) {
  if (!text || typeof text !== "string") return false;
  if (PHONE_RE.test(text)) return true;
  if (EMAIL_RE.test(text)) return true;
  return false;
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "messages debe ser un arreglo no vacío";
  }
  if (messages.length > MAX_MESSAGES) {
    return `Demasiados mensajes (máx ${MAX_MESSAGES})`;
  }
  let total = 0;
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) {
      return "role debe ser 'user' o 'assistant'";
    }
    if (typeof m.content !== "string" || m.content.length === 0) {
      return "content debe ser una cadena no vacía";
    }
    if (m.content.length > MAX_CONTENT_CHARS) {
      return `content máx ${MAX_CONTENT_CHARS} caracteres`;
    }
    total += m.content.length;
  }
  if (total > MAX_TOTAL_CHARS) {
    return `Conversación demasiado larga (máx ${MAX_TOTAL_CHARS} caracteres)`;
  }
  if (messages[messages.length - 1].role !== "user") {
    return "El último mensaje debe ser del usuario";
  }
  return null;
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // Kill switch — flip cardi_paused via Edge Config to pause globally
  // without a redeploy. Returns a friendly Spanish message the UI
  // surfaces verbatim.
  if (await getFlag("cardi_paused")) {
    return res.status(503).json({ error: "Cardi está pausado temporalmente. Intenta más tarde." });
  }

  // Pro gate — trial users do NOT pass (mirrors useSubscription's
  // isPro). The 403 carries an `action` field so the client can route
  // to the upgrade sheet instead of showing a generic error.
  if (!(await isProUser(user))) {
    return res.status(403).json({ error: "Cardi es una función Pro", action: "subscribe" });
  }

  // Per-user rate limit. 60/hour is generous (a power user might ask
  // 5-10 questions a day) but kills automated abuse cleanly.
  const rl = await rateLimit({
    endpoint: "cardi-ask",
    bucket: user.id,
    max: 60,
    windowSec: 3600,
  });
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter));
    return res.status(429).json({ error: "Has hecho muchas preguntas en poco tiempo. Intenta de nuevo en un momento." });
  }

  const { messages, context } = req.body || {};
  const validationError = validateMessages(messages);
  if (validationError) {
    return res.status(413).json({ error: validationError });
  }

  // PII soft filter on the LATEST user message. We don't scan history
  // because Claude's response could legitimately reference numbers
  // (e.g. "30 minutos") that match the regex when the user isn't
  // pasting a phone.
  const latest = messages[messages.length - 1].content;
  if (looksLikePII(latest)) {
    return res.status(422).json({
      error: "Por privacidad, no incluyas correos ni teléfonos en tus preguntas.",
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Cardi no está configurado" });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Streaming response. Once we commit to the SSE shape we can't change
  // status — any post-headers error is sent as a `data: {error: ...}`
  // event and the stream closes. Pre-headers errors (the validation
  // block above) still return JSON with the right HTTP status, so the
  // client's error-routing logic stays simple.
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Disable any reverse-proxy buffering (Vercel's CDN respects this).
  res.setHeader("X-Accel-Buffering", "no");
  res.statusCode = 200;
  // A leading comment line forces the headers to flush immediately so
  // the client's first byte arrives quickly even if Anthropic's first
  // token hasn't.
  res.write(": stream-open\n\n");

  const writeEvent = (obj) => {
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* socket closed */ }
  };

  try {
    const stream = await anthropic.messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      // Two-block system: the large static knowledge block is cached
      // (identical bytes across requests → ~10× cheaper repeats); the
      // per-request context block is NOT cached (changes with screen,
      // patient count, etc).
      system: [
        {
          type: "text",
          text: CARDI_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: buildCardiContext(context || {}),
        },
      ],
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta" &&
        event.delta.text
      ) {
        writeEvent({ text: event.delta.text });
      }
    }

    // Final message carries accumulated usage (incl. cache hit counts).
    // Best-effort — if the SDK doesn't expose finalMessage on this
    // version, just close cleanly without usage.
    let usage = null;
    try {
      const final = await stream.finalMessage();
      usage = final?.usage || null;
    } catch { /* ignore */ }

    writeEvent({ done: true, usage });
    res.end();
  } catch (err) {
    console.error("cardi-ask Anthropic error:", err?.message);
    writeEvent({ error: "Cardi no pudo responder. Intenta de nuevo." });
    res.end();
  }
}

export default withSentry(handler, { name: "cardi-ask" });
