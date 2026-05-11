import { useCallback, useRef, useState } from "react";

/* ── useAdminUndoToast ─────────────────────────────────────────────────
   Pair of (toast state, show, dismiss) helpers for the admin's
   fire-and-undo flows. The companion <AdminUndoToast> component
   renders the state. Kept in a separate file so the React refresh
   rule doesn't complain about mixing hook + component exports.

   `runUndo(t)` is exposed as the single entry point the toast UI uses
   to fire the user's `onUndo` callback. It guards against re-entry —
   a rapid double-tap, or a tap that lands during the auto-dismiss
   fade window, can otherwise call `onUndo` twice and flip the action
   back on (e.g. block → unblock → block again). The guard is a
   per-toast-id ref Set so even back-to-back toasts (different ids)
   each get exactly one undo.

   Usage: see AdminUndoToast.jsx docstring. */
export function useAdminUndoToast() {
  const [toast, setToast] = useState(null);
  const usedRef = useRef(new Set());

  const show = useCallback(({ message, onUndo, durationMs = 8000 }) => {
    setToast({
      id: Math.random().toString(36).slice(2),
      message,
      onUndo,
      durationMs,
    });
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  const runUndo = useCallback(async (t) => {
    if (!t || usedRef.current.has(t.id)) return;
    usedRef.current.add(t.id);
    try { await t.onUndo?.(); }
    catch {
      // Silent: caller can show its own error toast if needed. We
      // intentionally don't surface here because the toast component
      // is already mid-dismiss.
    }
    finally { setToast(null); }
  }, []);

  return { toast, show, dismiss, runUndo };
}
