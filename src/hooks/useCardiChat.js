import { useCallback, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

/* ── useCardiChat ─────────────────────────────────────────────────────
   In-memory chat state for the Cardi sheet. Lives only as long as the
   sheet is mounted — closing the sheet resets the thread (intentional
   v1: no persisted history).

   The endpoint streams Server-Sent Events. Each `data: {text: "..."}`
   payload is appended to the in-flight assistant message so users see
   the answer materialize token-by-token instead of waiting for the
   full response. `data: {done: true}` finalises; `data: {error: ...}`
   replaces the bubble with an inline retry chip.

   Pre-stream errors (auth, rate limit, paused, PII filter) still come
   back as JSON — `Content-Type: application/json` vs the streaming
   `text/event-stream` distinguishes them. */

const MAX_TURNS = 20;

export function useCardiChat({ context } = {}) {
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(false);
  // True from "first chunk received" to "stream done". Used by the
  // sheet to swap the thinking-dots bubble for the real, growing
  // assistant bubble.
  const [streaming, setStreaming] = useState(false);
  const lastUserRef = useRef(null);

  const reset = useCallback(() => {
    setMessages([]);
    lastUserRef.current = null;
  }, []);

  const send = useCallback(async (text) => {
    const trimmed = (text || "").trim();
    if (!trimmed || pending) return;

    const userMsg = { role: "user", content: trimmed };
    lastUserRef.current = userMsg;

    const next = [...messages.filter(m => !m.error), userMsg].slice(-MAX_TURNS);
    setMessages(next);
    setPending(true);
    setStreaming(false);

    const pushError = (errorKey, fallback) => {
      setMessages(prev => [
        ...prev.filter(m => !(m.role === "assistant" && m._streaming)),
        { role: "assistant", content: fallback || errorKey || "cardi.error", error: true, errorKey: errorKey || "cardi.error" },
      ]);
    };

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        pushError("cardi.error");
        return;
      }

      const res = await fetch("/api/cardi-ask", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: next,
          context: context || {},
        }),
      });

      // Pre-stream JSON errors (401/403/422/429/503/etc) — surface
      // with the right i18n key so the bubble shows a friendly
      // localised message.
      if (!res.ok) {
        const errorKey =
          res.status === 503 ? "cardi.paused"
          : res.status === 429 ? "cardi.rateLimit"
          : res.status === 422 ? "cardi.noPii"
          : res.status === 403 ? "cardi.proRequired"
          : "cardi.error";
        pushError(errorKey);
        return;
      }

      // Streaming path. Read SSE chunks from the response body and
      // mutate the in-flight assistant message on each text delta.
      if (!res.body || !res.body.getReader) {
        pushError("cardi.error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";
      let assistantPushed = false;

      const appendAssistant = (chunk) => {
        assistantContent += chunk;
        if (!assistantPushed) {
          assistantPushed = true;
          setStreaming(true);
          setMessages(prev => [...prev, { role: "assistant", content: assistantContent, _streaming: true }]);
        } else {
          setMessages(prev => {
            const out = [...prev];
            const last = out[out.length - 1];
            if (last && last.role === "assistant" && last._streaming) {
              out[out.length - 1] = { ...last, content: assistantContent };
            }
            return out;
          });
        }
      };

      const finaliseAssistant = () => {
        if (!assistantPushed) return;
        setMessages(prev => {
          const out = [...prev];
          const last = out[out.length - 1];
          if (last && last.role === "assistant" && last._streaming) {
            out[out.length - 1] = { role: "assistant", content: assistantContent };
          }
          return out;
        });
      };

      let streamDone = false;
      let streamErrored = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE messages are separated by a blank line ("\n\n"). Keep
        // any partial trailing fragment in the buffer for the next
        // read.
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          // Each "part" can have multiple lines (event:, data:, id:, etc).
          // We only emit `data:` lines from the server, so just look for
          // those. Ignore comment lines (": stream-open").
          for (const line of part.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).replace(/^ /, "");
            if (!payload) continue;
            let parsed;
            try { parsed = JSON.parse(payload); } catch { continue; }
            if (parsed.text) {
              appendAssistant(parsed.text);
            } else if (parsed.error) {
              streamErrored = true;
              pushError("cardi.error", parsed.error);
              return;
            } else if (parsed.done) {
              streamDone = true;
              finaliseAssistant();
            }
          }
        }
      }

      if (!streamErrored) {
        if (!streamDone) finaliseAssistant();
        if (!assistantPushed) {
          // Stream closed without producing any text — treat as error.
          pushError("cardi.error");
          return;
        }
        lastUserRef.current = null;
      }
    } catch {
      pushError("cardi.error");
    } finally {
      setPending(false);
      setStreaming(false);
    }
  }, [messages, pending, context]);

  const retry = useCallback(() => {
    if (!lastUserRef.current || pending) return;
    setMessages(prev => prev.filter(m => !m.error));
    send(lastUserRef.current.content);
  }, [send, pending]);

  return { messages, pending, streaming, send, retry, reset };
}
