/* POST /api/cardi-ask
   Cardi — in-app AI helper. Streaming SSE. Now with tool use: Claude
   can call list_patients / get_patient_detail / get_finance_summary
   to answer questions over the user's actual practice data. Server
   executes tools scoped to the auth'd user_id; results feed back
   into the conversation via the agentic loop.

   Request:
     { messages: [{ role: "user"|"assistant", content: string }, ...],
       context: { profession?, screen?, accessState?, patientCount?, sessionCount? } }

   Response: text/event-stream with `data: {text: "..."}` deltas,
   then `data: {done: true, usage: {...}}`. Pre-stream errors stay
   as JSON with a real HTTP status (401/403/422/429/503).

   PII boundary: tool outputs include patient names, sessions,
   payments, balances, schedules. They DO NOT include note bodies,
   phone numbers, emails, birthdate, allergies, medical conditions,
   or anthropometrics — see api/_cardiTools.js for the column-level
   filtering. The user must accept a separate data-access consent
   (cardi-data-v1) before the client opens the chat — gated by
   CardiConsentGate inside the sheet. */

import Anthropic from "@anthropic-ai/sdk";
import { getAuthUser } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import { getFlag } from "./_flags.js";
import { rateLimit } from "./_ratelimit.js";
import { isProUser } from "./_subscription.js";
import { CARDI_SYSTEM_PROMPT, buildCardiContext } from "../src/data/cardiKnowledge.js";
import { TOOL_DEFINITIONS, executeTool } from "./_cardiTools.js";

// Cap the agentic loop. In normal use Claude calls 0-2 tools per
// turn; 5 is a generous safety net against an infinite tool/text/
// tool oscillation.
const MAX_TOOL_TURNS = 5;

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

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.statusCode = 200;
  // Leading comment flushes headers so the client receives the first
  // byte fast, even if Anthropic's first token hasn't arrived yet.
  res.write(": stream-open\n\n");

  const writeEvent = (obj) => {
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* socket closed */ }
  };

  // Working copy of the conversation. We append assistant messages
  // (with tool_use blocks) and user messages (with tool_result blocks)
  // as the agentic loop runs.
  const convo = messages.slice();
  let totalUsage = null;

  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const stream = await anthropic.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        // Two-block system: the static knowledge block is cached
        // (~10× cheaper repeat input). The per-request context
        // block isn't.
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
        tools: TOOL_DEFINITIONS,
        messages: convo,
      });

      // Stream text deltas as they arrive. Tool-use blocks come as
      // separate events; we don't need to surface them token-by-token
      // (they're invisible to the user anyway).
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta?.type === "text_delta" &&
          event.delta.text
        ) {
          writeEvent({ text: event.delta.text });
        }
      }

      const final = await stream.finalMessage();
      // Accumulate usage across turns so the client sees the full
      // cost. Just sum the simple counters; cache_creation /
      // cache_read are surfaced from the last turn since aggregating
      // them across turns isn't meaningful.
      if (final?.usage) {
        if (!totalUsage) {
          totalUsage = { ...final.usage };
        } else {
          totalUsage.input_tokens = (totalUsage.input_tokens || 0) + (final.usage.input_tokens || 0);
          totalUsage.output_tokens = (totalUsage.output_tokens || 0) + (final.usage.output_tokens || 0);
        }
      }

      // No tool calls → final answer. Close the stream.
      if (final.stop_reason !== "tool_use") {
        writeEvent({ done: true, usage: totalUsage });
        res.end();
        return;
      }

      // Tool calls. Echo a hint to the client so the UI can show
      // "Buscando en tus datos…" or similar; then execute each tool
      // and append the results, then loop for Claude's next turn.
      writeEvent({ status: "running_tools" });

      // Append the assistant turn verbatim — we need the tool_use
      // blocks intact for the tool_result references.
      convo.push({ role: "assistant", content: final.content });

      const toolResults = [];
      for (const block of final.content) {
        if (block.type !== "tool_use") continue;
        let resultPayload;
        let isError = false;
        try {
          const out = await executeTool(block.name, block.input, user.id);
          resultPayload = JSON.stringify(out);
        } catch (err) {
          console.error(`cardi-ask tool ${block.name} failed:`, err?.message);
          resultPayload = JSON.stringify({ error: err?.message || "tool error" });
          isError = true;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: resultPayload,
          is_error: isError,
        });
      }
      // Mark the LAST tool_result with cache_control so a follow-up
      // question in the same chat session ("y de María?") re-uses the
      // prior tool data as cache instead of paying full input cost
      // again. The 5-min ephemeral window covers a typical multi-turn
      // chat. Cache breakpoints stack with the system prompt's one;
      // Anthropic supports up to 4 breakpoints per request.
      if (toolResults.length > 0) {
        toolResults[toolResults.length - 1].cache_control = { type: "ephemeral" };
      }
      convo.push({ role: "user", content: toolResults });
    }

    // Hit the loop cap — close gracefully.
    writeEvent({ done: true, usage: totalUsage, truncated: true });
    res.end();
  } catch (err) {
    console.error("cardi-ask Anthropic error:", err?.message);
    writeEvent({ error: "Cardi no pudo responder. Intenta de nuevo." });
    res.end();
  }
}

export default withSentry(handler, { name: "cardi-ask" });
