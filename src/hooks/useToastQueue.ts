import { useState, useRef, useCallback, useEffect } from "react";

/* ── useToastQueue ────────────────────────────────────────────────────
   The app's single toast channel, extracted verbatim from App.tsx's
   AppShell so the shell stops owning ~90 lines of queue plumbing. Every
   surface (success confirms, the undoable-delete window, mutation/fetch
   errors) pushes into ONE queue; the UI renders up to MAX_TOASTS with a
   stagger, oldest fading first. Persistent toasts (the error channels)
   don't auto-dismiss.

   The two data-layer error channels are wired here too: a mutationError
   or fetchError from useCardiganData surfaces as a persistent, retry-able,
   key-deduped toast and clears when the error resolves. Dismissing the
   mutation-error toast also clears the underlying data-layer error so the
   same message can re-raise later.

   Inputs are the data-layer error signals + the i18n t(); returns the
   toast list + the push/dismiss API the shell threads into context. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const MAX_TOASTS = 5;

export interface ToastQueueDeps {
  mutationError?: string;
  fetchError?: string;
  clearMutationError?: () => void;
  refresh?: () => void;
  t: (key: string) => string;
}

export function useToastQueue({ mutationError, fetchError, clearMutationError, refresh, t }: ToastQueueDeps) {
  const [toasts, setToasts] = useState<Row[]>([]);
  const nextToastIdRef = useRef(0);

  const showToast = useCallback((msg: string, type = "info", opts: Row = {}) => {
    if (!msg) return null;
    const id = ++nextToastIdRef.current;
    setToasts(prev => {
      // Drop an earlier entry with the same key (e.g. reopening the
      // mutation-error channel) before appending, so the user only
      // sees one copy of a recurring message at a time.
      const base = opts.key ? prev.filter((t2: Row) => t2.key !== opts.key) : prev;
      const next = [...base, {
        id, kind: type, message: msg,
        persistent: !!opts.persistent,
        // Forward `duration` so callers (e.g. withUndoableDelete's 3-second
        // window) can override the 1.4s default. Previously dropped here,
        // which silently made the "Deshacer" toast disappear at 1.4s
        // while the commit timer still ran out to 5s — leaving ~3.6s of
        // ghost-undo state where the row was gone, no toast visible, no
        // way to recover. ToastStack forwards the value through to <Toast>.
        duration: opts.duration,
        onRetry: opts.onRetry,
        actionLabel: opts.actionLabel,
        key: opts.key,
      }];
      if (next.length <= MAX_TOASTS) return next;
      // Over cap: drop oldest non-persistent first.
      const out: Row[] = [];
      let toDrop = next.length - MAX_TOASTS;
      for (const t2 of next) {
        if (toDrop > 0 && !t2.persistent) { toDrop--; continue; }
        out.push(t2);
      }
      return out;
    });
    return id;
  }, []);

  // When the user dismisses the mutation-error toast we also clear
  // the underlying data-layer error so a subsequent failure with the
  // same message can re-raise (setMutationError is a no-op when the
  // new value matches the stale one).
  const dismissToast = useCallback((id: string | number) => {
    setToasts(prev => {
      const toast = prev.find((t2: Row) => t2.id === id);
      if (toast?.key === "mutation-error") clearMutationError?.();
      return prev.filter((t2: Row) => t2.id !== id);
    });
  }, [clearMutationError]);

  const showSuccess = useCallback((msg: string) => {
    if (!msg) return;
    showToast(msg, "success");
  }, [showToast]);

  // Surface mutation errors as a persistent toast; clear it when the
  // error resolves.
  useEffect(() => {
    if (mutationError) {
      showToast(mutationError, "error", { persistent: true, onRetry: refresh, key: "mutation-error" });
    } else {
      // Functional updater returns `prev` unchanged when there's nothing
      // to remove, so React bails out — no cascading render. The
      // set-state-in-effect rule can't see the bail-out, so disable it
      // here (clearing a resolved error toast is a legitimate sync).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToasts(prev => prev.some(x => x.key === "mutation-error")
        ? prev.filter(x => x.key !== "mutation-error")
        : prev);
    }
  }, [mutationError, showToast, refresh]);

  // Surface a FAILED initial data load (e.g. launched in airplane mode,
  // or the network dropped during the parallel fetch). Without this the
  // app paints empty "no data yet" states with no hint that the load
  // failed and no way to retry. Mirrors the mutationError toast:
  // persistent, retry-able, de-duped by key. fetchError resets to "" at
  // the start of each fetch, so a successful refresh clears it.
  useEffect(() => {
    if (fetchError) {
      showToast(t("loadFailed"), "error", { persistent: true, onRetry: refresh, key: "fetch-error" });
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToasts(prev => prev.some(x => x.key === "fetch-error")
        ? prev.filter(x => x.key !== "fetch-error")
        : prev);
    }
  }, [fetchError, showToast, refresh, t]);

  return { toasts, showToast, showSuccess, dismissToast };
}
