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

// The Web Speech API isn't in the standard TS DOM lib (and
// webkitSpeechRecognition never will be), so model the slice we use.
interface SRResultItem { transcript?: string }
interface SRResult { isFinal: boolean; [i: number]: SRResultItem }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SRErrorEvent { error?: string }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

const RECOGNITION: SRCtor | null =
  typeof window !== "undefined"
    ? ((window as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }).SpeechRecognition
       || (window as { webkitSpeechRecognition?: SRCtor }).webkitSpeechRecognition
       || null)
    : null;

export function useVoiceDictation({ lang = "es-MX", onResult }: { lang?: string; onResult?: (text: string) => void } = {}) {
  const [supported] = useState(() => !!RECOGNITION);
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");

  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const userStoppedRef = useRef(false);
  // Auto-restart counter. The engine sometimes hits an unrecoverable
  // state (mid-permission revoke, audio device disappearing) that
  // doesn't surface a proper onerror code. Without a cap the onend
  // handler would spin restart attempts forever. Reset to 0 on any
  // successful result so an active user isn't bitten by an earlier
  // hiccup.
  const restartAttemptsRef = useRef(0);
  const MAX_RESTART_ATTEMPTS = 5;
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
    restartAttemptsRef.current = 0;

    const r = new RECOGNITION!();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (event) => {
      // Engine is working — clear any prior restart accumulation so
      // a transient earlier hiccup doesn't haunt the rest of the session.
      restartAttemptsRef.current = 0;
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
      // restart so the recording-state stays live for them — but
      // cap restart attempts so we can't spin forever against a
      // truly broken engine.
      if (userStoppedRef.current) {
        setRecording(false);
        setInterim("");
        recogRef.current = null;
        return;
      }
      if (restartAttemptsRef.current >= MAX_RESTART_ATTEMPTS) {
        setError("restart_exhausted");
        userStoppedRef.current = true;
        setRecording(false);
        setInterim("");
        recogRef.current = null;
        return;
      }
      restartAttemptsRef.current += 1;
      try {
        r.start();
      } catch {
        // start() can throw if the engine is still tearing down —
        // give it a beat and try again. Still bounded by the
        // counter incremented above.
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
      setError((e as Error)?.name || "start-failed");
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
