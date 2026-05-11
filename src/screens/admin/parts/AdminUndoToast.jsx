import { Toast } from "../../../components/Toast";

/* ── AdminUndoToast ────────────────────────────────────────────────────
   Fire-and-undo helper for admin actions that aren't destructive enough
   to warrant a typed-confirm dialog (block/unblock, grant/revoke comp).
   The action runs IMMEDIATELY — this toast just exposes an 8-second
   window to undo by hitting the API the other way.

   Pattern in the caller:
     const { toast, show, dismiss } = useAdminUndoToast();
     await adminBlockUser(uid, true);
     show({ message: "Bloqueado…", onUndo: async () => adminBlockUser(uid, false) });
     ...
     return (<><AdminUndoToast toast={toast} onDismiss={dismiss} /></>);

   The undo callback runs whatever the caller passes. If the caller
   wants to fully revert local UI state on undo, they handle that
   inside `onUndo`. */
export function AdminUndoToast({ toast, onDismiss }) {
  if (!toast) return null;
  return (
    <Toast
      key={toast.id}
      message={toast.message}
      type="success"
      duration={toast.durationMs}
      actionLabel="Deshacer"
      onRetry={async () => {
        try { await toast.onUndo?.(); }
        catch {
          // Caller can show its own error toast if needed; swallow here.
        }
        finally { onDismiss?.(); }
      }}
      onDismiss={onDismiss}
    />
  );
}

// The companion `useAdminUndoToast` hook lives in ./useAdminUndoToast
// — callers import them from each file separately to satisfy the
// react-refresh "components-only export" rule.
