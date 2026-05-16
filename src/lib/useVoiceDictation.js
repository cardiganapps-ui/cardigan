import { useCallback, useEffect, useRef, useState } from "react";

/* ── useVoiceDictation ────────────────────────────────────────────
   Phase 4 of the Notes premium roadmap. Thin wrapper around the
   Web Speech API's SpeechRecognition. Exposes a start/stop pair, a
   `supported` flag, and an `onResult(text)` callback that fires
   exactly once per finalised utterance (interim results are
   surfaced separately so the UI can show the live transcript
   strip).

   ⚠️  Scope-cut: Chromium-only. `webkitSpeechRecognition` on iOS
   Safari silently stops at ~60s, lacks continuous mode, and ships
   mediocre Spanish recognition. We feature-detect and let callers
   hide the mic button when `supported === false`. Revisit only if
   telemetry shows hidden-button rate < 30%.

   The hook owns the recogniser instance; restarting after a
   recognised stop (Chrome auto-stops after a few seconds of
   silence) keeps the session going as long as the user wanted
   "continuous" dictation. We bail out when stop() was the user's
   explicit choice, tracked via a ref that survives the onend
   callback.

   Permission denial / no-mic / network errors land in `error`.
   Surfaces a stable error code (string) so the consumer can map
   it to localised copy. */

const RECOGNITION =
  typeof window !== "undefined"
    ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
    : null;

export function useVoiceDictation({ lang = "es-MX", onResult } = {}) {
  const [supported] = useState(() => !!RECOGNITION);
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");

  const recogRef = useRef(null);
  const userStoppedRef = useRef(false);
  // Stash the latest onResult so the recogniser callbacks don't
  // capture a stale closure across renders. The recogniser
  // instance is created once per start() — without this we'd lose
  // every chunk after the consumer re-renders.
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  const stop = useCallback(() => {
    userStoppedRef.current = true;
    setRecording(false);
    setInterim("");
    const r = recogRef.current;
    if (r) {
      try { r.stop(); } catch { /* already stopped */ }
    }
  }, []);

  const start = useCallback(() => {
    if (!supported) { setError("unsupported"); return; }
    if (recording) return;
    setError("");
    setInterim("");
    userStoppedRef.current = false;

    const r = new RECOGNITION();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (event) => {
      let liveInterim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const transcript = res[0]?.transcript || "";
        if (res.isFinal) {
          // Final chunks are committed via onResult. The hook itself
          // doesn't buffer — that's the consumer's job (e.g., insert
          // at the editor's caret).
          if (transcript) onResultRef.current?.(transcript);
        } else {
          liveInterim += transcript;
        }
      }
      setInterim(liveInterim);
    };

    r.onerror = (e) => {
      // Common codes:
      //   not-allowed   → user denied the mic prompt
      //   no-speech     → silence timeout, fine to ignore + auto-restart
      //   audio-capture → no mic available
      //   network       → STT service unreachable
      //   aborted       → we called stop(); not a user-visible error
      const code = e?.error || "unknown";
      if (code === "aborted" || code === "no-speech") return;
      setError(code);
      userStoppedRef.current = true;
      setRecording(false);
    };

    r.onend = () => {
      // Chrome stops the session after a stretch of silence even
      // with continuous=true. If the user hasn't asked to stop,
      // restart so the recording-state stays live for them.
      if (userStoppedRef.current) {
        setRecording(false);
        setInterim("");
        recogRef.current = null;
        return;
      }
      try {
        r.start();
      } catch {
        // start() can throw if the engine is still tearing down —
        // give it a beat and try again.
        setTimeout(() => {
          if (!userStoppedRef.current) {
            try { r.start(); } catch { setRecording(false); }
          }
        }, 250);
      }
    };

    try {
      r.start();
      recogRef.current = r;
      setRecording(true);
    } catch (e) {
      setError(e?.name || "start-failed");
      setRecording(false);
    }
  }, [supported, recording, lang]);

  // Clean up on unmount — a recogniser left running across a
  // navigation would keep the mic indicator on indefinitely.
  useEffect(() => () => {
    userStoppedRef.current = true;
    const r = recogRef.current;
    if (r) { try { r.stop(); } catch { /* ignore */ } }
    recogRef.current = null;
  }, []);

  return { supported, recording, interim, error, start, stop };
}
