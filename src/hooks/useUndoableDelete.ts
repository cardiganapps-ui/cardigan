import { useCallback } from "react";
import { haptic } from "../utils/haptics";

/* ── useUndoableDelete ────────────────────────────────────────────────
   Undo-aware delete wrapper, extracted from AppShell. Takes a `softFn`
   that returns { commit, undo } (defined per-domain in useSessions /
   usePayments / useExpenses / useNotes) and orchestrates:
     1. Optimistic state change happens immediately inside softFn.
     2. A "X eliminado · Deshacer" toast shows for UNDO_MS.
     3. If the user taps "Deshacer" within the window → undo() runs and
        the row reappears in place. No network call.
     4. Otherwise the timer fires → commit() runs the server-side delete
        (or enqueues offline).
     5. If the tab is backgrounded mid-window, commit() runs eagerly via
        the visibilitychange handler — closing the tab would kill the
        setTimeout and silently leave the row in the DB.
   Returns true so callers using `await delete(id)` see the same success
   contract as before.

   Pulled into a hook so AppShell stops owning the timer/visibility
   plumbing; the single dependency is the toast channel. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const UNDO_MS = 3000;

type ShowToast = (msg: string, kind?: string, opts?: Row) => void;

export function useUndoableDelete(showToast: ShowToast) {
  return useCallback((softFn: Row, label: string) => async (...args: Row[]) => {
    if (typeof softFn !== "function") return false;
    const handle = softFn(...args);
    if (!handle || typeof handle.commit !== "function") return false;

    let done = false;
    // eslint-disable-next-line prefer-const -- referenced in cleanup() closure below before its single assignment
    let timer: ReturnType<typeof setTimeout>;
    const onHidden = () => { if (document.visibilityState === "hidden") finalize(); };
    const cleanup = () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHidden);
    };
    const finalize = () => {
      if (done) return;
      done = true;
      cleanup();
      handle.commit();
    };
    const restore = () => {
      if (done) return;
      done = true;
      cleanup();
      handle.undo();
    };

    timer = setTimeout(finalize, UNDO_MS);
    document.addEventListener("visibilitychange", onHidden);
    haptic.tap();
    showToast(label, "info", {
      actionLabel: "Deshacer",
      onRetry: restore,
      duration: UNDO_MS,
    });
    return true;
  }, [showToast]);
}
