import { useCallback, useEffect, useReducer, useRef } from "react";
import { supabase } from "../supabaseClient";

// ── Persistence helpers ──────────────────────────────────────────────
const LS_DONE_PREFIX = "cardigan-tutorial-done-";

function localDoneKey(userId: string | null | undefined) { return LS_DONE_PREFIX + (userId || "anon"); }

function readLocalDone(userId: string | null | undefined) {
  try { return !!localStorage.getItem(localDoneKey(userId)); } catch { return false; }
}
function writeLocalDone(userId: string | null | undefined) {
  try { localStorage.setItem(localDoneKey(userId), "1"); } catch { /* private mode / quota — non-fatal */ }
}

async function writeMetadataDone() {
  try {
    await supabase.auth.updateUser({ data: { tutorial_completed_at: new Date().toISOString() } });
  } catch {
    // Non-fatal — localStorage mirror still gates the prompt.
  }
}

// ── Reducer ──────────────────────────────────────────────────────────
// states: "idle" | "welcome" | "running" | "done"
//
// The carousel owns its own slide index; the hook is a pure on/off +
// persistence machine. App.jsx reads `state` ("running"/"done") to
// coordinate the Welcome-to-Pro prompt, so the string values are stable.
interface TutorialState { state: string }
interface TutorialAction { type: string }
const initial: TutorialState = { state: "idle" };

function reducer(s: TutorialState, a: TutorialAction): TutorialState {
  switch (a.type) {
    case "showWelcome": return { state: "welcome" };
    case "start":       return { state: "running" };
    case "finish":      return { state: "done" };
    case "close":       return { state: "done" };
    default: return s;
  }
}

/**
 * Tutorial state hook.
 * Owns persistence (localStorage + Supabase user metadata) and the
 * first-login gate. The consumer (Tutorial carousel) drives the UI.
 */
interface TutorialUser { id?: string; user_metadata?: { tutorial_completed_at?: string | null } | null }

export function useTutorial({ user, demo, readOnly, screen }: { user?: TutorialUser | null; demo?: boolean; readOnly?: boolean; screen?: string } = {}) {
  const [state, dispatch] = useReducer(reducer, initial);
  const userId = user?.id || null;
  const disabled = !!demo || !!readOnly || !user;

  // Track whether we already dispatched the welcome prompt for this user
  // session, so subsequent screen changes don't re-schedule it.
  const gateCheckedRef = useRef<string | null>(null);

  // ── Initial gate check ──
  //
  // Schedule the welcome modal once per user session, but ONLY while the
  // user is on Home. If they landed on a deep link (e.g. /p/<patientId>
  // from a shared expediente URL), the modal would interrupt that flow —
  // worse, dismissing it stamps `done` and the user loses the tour
  // entirely. Wait until they navigate back to Home, then schedule.
  //
  // gateCheckedRef is set inside the timer callback (not at the top of
  // the effect) so a navigation-away during the 800ms warmup doesn't
  // burn the gate; the next return to Home gets a fresh attempt.
  useEffect(() => {
    if (disabled) return;
    if (gateCheckedRef.current === userId) return;
    if (screen !== "home") return;

    const localDone = readLocalDone(userId);
    const metaDone = !!user?.user_metadata?.tutorial_completed_at;

    if (localDone || metaDone) {
      // Already completed — mark the gate so subsequent screen changes
      // don't re-evaluate, and return.
      gateCheckedRef.current = userId;
      return;
    }

    const timer = setTimeout(() => {
      // Re-check done status right before firing — avoids a race where
      // another tab / the auth metadata refreshed in the meantime.
      if (readLocalDone(userId)) return;
      // Mark the gate AFTER the timer fires so a navigation-away during
      // the 800ms warmup doesn't permanently disable the welcome for
      // this session.
      gateCheckedRef.current = userId;
      dispatch({ type: "showWelcome" });
    }, 800);

    return () => clearTimeout(timer);
  }, [disabled, userId, user?.user_metadata?.tutorial_completed_at, screen]);

  // ── Mark done on entering "done" ──
  const markedDoneRef = useRef(false);
  useEffect(() => {
    if (state.state === "done" && !markedDoneRef.current) {
      markedDoneRef.current = true;
      writeLocalDone(userId);
      writeMetadataDone();
    }
    if (state.state !== "done") markedDoneRef.current = false;
  }, [state.state, userId]);

  // ── Actions ──
  const start = useCallback(() => dispatch({ type: "start" }), []);
  const skip = useCallback(() => dispatch({ type: "close" }), []);
  const finish = useCallback(() => dispatch({ type: "finish" }), []);

  // Called from Settings → "Tutorial" row. Clears persistence and starts
  // the carousel directly (skips the welcome gate).
  const reset = useCallback(() => {
    try {
      localStorage.removeItem(localDoneKey(userId));
    } catch { /* non-fatal */ }
    markedDoneRef.current = false;
    // Best-effort: clear the metadata flag so other devices also re-prompt.
    supabase.auth.updateUser({ data: { tutorial_completed_at: null } }).catch(() => {});
    dispatch({ type: "start" });
  }, [userId]);

  return {
    state: state.state,
    isActive: state.state === "running",
    isWelcome: state.state === "welcome",
    start,
    skip,
    finish,
    reset,
  };
}
