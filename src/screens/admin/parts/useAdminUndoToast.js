import { useCallback, useState } from "react";

/* ── useAdminUndoToast ─────────────────────────────────────────────────
   Pair of (toast state, show, dismiss) helpers for the admin's
   fire-and-undo flows. The companion <AdminUndoToast> component
   renders the state. Kept in a separate file so the React refresh
   rule doesn't complain about mixing hook + component exports.

   Usage: see AdminUndoToast.jsx docstring. */
export function useAdminUndoToast() {
  const [toast, setToast] = useState(null);
  const show = useCallback(({ message, onUndo, durationMs = 8000 }) => {
    setToast({
      id: Math.random().toString(36).slice(2),
      message,
      onUndo,
      durationMs,
    });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);
  return { toast, show, dismiss };
}
