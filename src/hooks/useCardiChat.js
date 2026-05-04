import { useCallback, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

/* ── useCardiChat ─────────────────────────────────────────────────────
   In-memory chat state for the Cardi sheet. Lives only as long as the
   sheet is mounted — closing the sheet resets the thread (intentional
   v1: no persisted history, no new sensitive store to manage).

   Shape per message: { role: "user" | "assistant", content: string,
                        error?: boolean }

   Errors are surfaced as a synthetic assistant message with error=true
   so the UI can render an inline retry chip instead of a normal bubble. */

const MAX_TURNS = 20;

export function useCardiChat({ context } = {}) {
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(false);
  // Track the last user message so a retry can re-send it without
  // requiring the user to re-type. Cleared after a successful turn.
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

    // Optimistically append the user's message; clear any prior error
    // bubble (it's a one-shot).
    const next = [...messages.filter(m => !m.error), userMsg].slice(-MAX_TURNS);
    setMessages(next);
    setPending(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("no-session");

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

      if (!res.ok) {
        let detail = null;
        try { detail = await res.json(); } catch { /* ignore */ }
        // Map well-known status codes to translation keys the UI can
        // render verbatim. Anything else falls back to the generic
        // error string the server returned (already in Spanish from
        // the endpoint).
        const errorKey =
          res.status === 503 ? "cardi.paused"
          : res.status === 429 ? "cardi.rateLimit"
          : res.status === 422 ? "cardi.noPii"
          : res.status === 403 ? "cardi.proRequired"
          : null;
        const errorMsg = errorKey || detail?.error || "cardi.error";
        setMessages(prev => [...prev, { role: "assistant", content: errorMsg, error: true, errorKey }]);
        return;
      }

      const data = await res.json();
      const answer = (data?.answer || "").trim();
      if (!answer) {
        setMessages(prev => [...prev, { role: "assistant", content: "cardi.error", error: true, errorKey: "cardi.error" }]);
        return;
      }
      setMessages(prev => [...prev, { role: "assistant", content: answer }]);
      lastUserRef.current = null;
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "cardi.error", error: true, errorKey: "cardi.error" }]);
    } finally {
      setPending(false);
    }
  }, [messages, pending, context]);

  const retry = useCallback(() => {
    if (!lastUserRef.current || pending) return;
    // Strip the prior error bubble + re-send the last user message.
    setMessages(prev => prev.filter(m => !m.error));
    send(lastUserRef.current.content);
  }, [send, pending]);

  return { messages, pending, send, retry, reset };
}
