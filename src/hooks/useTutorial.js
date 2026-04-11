import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { supabase } from "../supabaseClient";
import { TUTORIAL_STEPS } from "../components/Tutorial/tutorialSteps";

// ── Persistence helpers ──────────────────────────────────────────────
const LS_DONE_PREFIX = "cardigan-tutorial-done-";
const LS_PROGRESS_PREFIX = "cardigan-tutorial-progress-";

function localDoneKey(userId) { return LS_DONE_PREFIX + (userId || "anon"); }
function localProgressKey(userId) { return LS_PROGRESS_PREFIX + (userId || "anon"); }

function readLocalDone(userId) {
  try { return !!localStorage.getItem(localDoneKey(userId)); } catch { return false; }
}
function writeLocalDone(userId) {
  try { localStorage.setItem(localDoneKey(userId), "1"); } catch {}
}
function readLocalProgress(userId) {
  try {
    const raw = localStorage.getItem(localProgressKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.stepIndex === "number") return parsed;
    return null;
  } catch { return null; }
}
function writeLocalProgress(userId, stepIndex) {
  try { localStorage.setItem(localProgressKey(userId), JSON.stringify({ stepIndex })); } catch {}
}
function clearLocalProgress(userId) {
  try { localStorage.removeItem(localProgressKey(userId)); } catch {}
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
const initial = { state: "idle", stepIndex: 0 };

function reducer(s, a) {
  switch (a.type) {
    case "showWelcome": return { state: "welcome", stepIndex: 0 };
    case "start":       return { state: "running", stepIndex: a.stepIndex ?? 0 };
    case "next": {
      const nextIdx = s.stepIndex + 1;
      if (nextIdx >= TUTORIAL_STEPS.length) return { state: "done", stepIndex: 0 };
      return { state: "running", stepIndex: nextIdx };
    }
    case "prev": {
      if (s.state !== "running") return s;
      return { state: "running", stepIndex: Math.max(0, s.stepIndex - 1) };
    }
    case "setIndex": return { state: "running", stepIndex: a.stepIndex };
    case "finish":   return { state: "done", stepIndex: 0 };
    case "close":    return { state: "done", stepIndex: 0 };
    default: return s;
  }
}

/**
 * Tutorial state hook.
 * Owns persistence (localStorage + Supabase user metadata).
 * The consumer (Tutorial orchestrator) is responsible for screen navigation
 * and spotlight measurement based on the `step` returned here.
 */
export function useTutorial({ user, demo, readOnly } = {}) {
  const [state, dispatch] = useReducer(reducer, initial);
  const userId = user?.id || null;
  const disabled = !!demo || !!readOnly || !user;

  // Track whether we already checked the gate for the current user, so the
  // welcome prompt is only scheduled once per session.
  const gateCheckedRef = useRef(null);

  // ── Initial gate check ──
  useEffect(() => {
    if (disabled) return;
    if (gateCheckedRef.current === userId) return;
    gateCheckedRef.current = userId;

    const localDone = readLocalDone(userId);
    const metaDone = !!user?.user_metadata?.tutorial_completed_at;

    if (localDone || metaDone) {
      // Already completed — remain idle.
      return;
    }

    // Check if we have an in-progress run to resume after a reload.
    const progress = readLocalProgress(userId);
    const timer = setTimeout(() => {
      if (progress && progress.stepIndex > 0 && progress.stepIndex < TUTORIAL_STEPS.length) {
        dispatch({ type: "start", stepIndex: progress.stepIndex });
      } else {
        dispatch({ type: "showWelcome" });
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [disabled, userId, user?.user_metadata?.tutorial_completed_at]);

  // ── Persist progress while running ──
  useEffect(() => {
    if (state.state === "running" && userId) {
      writeLocalProgress(userId, state.stepIndex);
    }
  }, [state.state, state.stepIndex, userId]);

  // ── Mark done on entering "done" ──
  const markedDoneRef = useRef(false);
  useEffect(() => {
    if (state.state === "done" && !markedDoneRef.current) {
      markedDoneRef.current = true;
      writeLocalDone(userId);
      clearLocalProgress(userId);
      writeMetadataDone();
    }
    if (state.state !== "done") markedDoneRef.current = false;
  }, [state.state, userId]);

  // ── Actions ──
  const start = useCallback(() => dispatch({ type: "start", stepIndex: 0 }), []);
  const next = useCallback(() => dispatch({ type: "next" }), []);
  const prev = useCallback(() => dispatch({ type: "prev" }), []);
  const skip = useCallback(() => dispatch({ type: "close" }), []);
  const finish = useCallback(() => dispatch({ type: "finish" }), []);
  const setIndex = useCallback((i) => dispatch({ type: "setIndex", stepIndex: i }), []);

  // Called from Settings → "Tutorial" row. Clears persistence and starts again.
  const reset = useCallback(() => {
    try {
      localStorage.removeItem(localDoneKey(userId));
      localStorage.removeItem(localProgressKey(userId));
    } catch {}
    markedDoneRef.current = false;
    // Best-effort: clear the metadata flag so other devices also re-prompt.
    supabase.auth.updateUser({ data: { tutorial_completed_at: null } }).catch(() => {});
    dispatch({ type: "start", stepIndex: 0 });
  }, [userId]);

  const step = useMemo(() => {
    if (state.state !== "running") return null;
    return TUTORIAL_STEPS[state.stepIndex] || null;
  }, [state.state, state.stepIndex]);

  const totalSteps = TUTORIAL_STEPS.length;
  const isFirst = state.stepIndex === 0;
  const isLast = state.stepIndex === totalSteps - 1;

  return {
    state: state.state,
    stepIndex: state.stepIndex,
    totalSteps,
    step,
    isActive: state.state === "running",
    isWelcome: state.state === "welcome",
    isFirst,
    isLast,
    start,
    next,
    prev,
    skip,
    finish,
    reset,
    setIndex,
  };
}
