import { Toast } from "../../../components/Toast";

/* ── AdminUndoToast ────────────────────────────────────────────────────
   Fire-and-undo helper for admin actions that aren't destructive enough
   to warrant a typed-confirm dialog (block/unblock, grant/revoke comp).
   The action runs IMMEDIATELY — this toast just exposes an 8-second
   window to undo by hitting the API the other way.

   Pattern in the caller:
     const { toast, show, dismiss, runUndo } = useAdminUndoToast();
     await adminBlockUser(uid, true);
     show({ message: "Bloqueado…", onUndo: async () => adminBlockUser(uid, false) });
     ...
     return (<><AdminUndoToast toast={toast} onDismiss={dismiss} runUndo={runUndo} /></>);

   `runUndo` is the idempotent entry point that the toast UI calls
   when the user taps "Deshacer". The hook guards against re-entry so
   a rapid double-tap (or a tap that lands during the auto-dismiss
   fade) can't fire `onUndo` twice and flip the action back on. */
export function AdminUndoToast({ toast, onDismiss, runUndo }) {
  if (!toast) return null;
  return (
    <Toast
      key={toast.id}
      message={toast.message}
      type="success"
      duration={toast.durationMs}
      actionLabel="Deshacer"
      onRetry={() => runUndo?.(toast)}
      onDismiss={onDismiss}
    />
  );
}

// The companion `useAdminUndoToast` hook lives in ./useAdminUndoToast
// — callers import them from each file separately to satisfy the
// react-refresh "components-only export" rule.
