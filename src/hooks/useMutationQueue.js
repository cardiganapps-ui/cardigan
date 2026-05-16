import { useEffect, useState } from "react";
import { init, subscribe, drain, getEntries } from "../lib/mutationQueue.js";
import { useConnectivity } from "./useConnectivity.js";

/* ── useMutationQueue ─ React surface for the offline queue.
   Initializes the queue on mount (loads from IndexedDB), exposes the
   current entry list to subscribers, and auto-drains when connectivity
   is restored.

   Returned shape:
     • entries           — array of queued mutation entries. Empty
                           when the queue is idle.
     • online            — current navigator.onLine state.
     • flushing          — true while drain() is in flight.
     • lastDrainResult   — { drained, remaining, at } | null. Set after
                           every drain that touched the queue (drained
                           > 0). Used by the App-level toast to surface
                           "X cambios guardados" feedback. App.jsx
                           reads + clears it after rendering.
     • flush()           — manual trigger (Reintentar button in the
                           offline banner).
     • acknowledgeDrain()— clears lastDrainResult after the consumer
                           has handled it.

   The hook does NOT enqueue — call sites import enqueue() from
   ../lib/mutationQueue directly. This hook owns lifecycle + UI signal.
*/
export function useMutationQueue() {
  const [entries, setEntries] = useState(() => getEntries());
  const [flushing, setFlushing] = useState(false);
  const [lastDrainResult, setLastDrainResult] = useState(null);
  const { online } = useConnectivity();

  // Initialize the queue + subscribe to changes. init() loads from
  // IndexedDB; subscribe() pushes updates on every enqueue / drain
  // step so the UI count is always current.
  useEffect(() => {
    let mounted = true;
    init().then(() => {
      if (mounted) setEntries(getEntries());
    });
    const unsub = subscribe((next) => {
      if (mounted) setEntries(next);
    });
    return () => { mounted = false; unsub(); };
  }, []);

  // Service Worker nudge listener — Phase 6. When the SW fires its
  // `sync` event (browser-managed; happens on reconnect even when the
  // tab is backgrounded), it broadcasts DRAIN_QUEUE_NUDGE to every
  // client. Drain immediately. Complements the visibility / online
  // event paths; sometimes the SW notices reconnect first.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
    const handler = async (event) => {
      if (event?.data?.type === "DRAIN_QUEUE_NUDGE") {
        setFlushing(true);
        try {
          const result = await drain();
          if (result.drained > 0) setLastDrainResult({ ...result, at: Date.now() });
        } finally { setFlushing(false); }
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, []);

  // Auto-drain on reconnect. Small delay so DNS / proxy settle before
  // we hammer the queue — 1.5s is a balance between responsiveness
  // and false-start (page load → ephemerally offline → online flicker).
  useEffect(() => {
    if (!online) return;
    if (entries.length === 0) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      setFlushing(true);
      try {
        const result = await drain();
        if (!cancelled && result.drained > 0) {
          setLastDrainResult({ ...result, at: Date.now() });
        }
      } finally { if (!cancelled) setFlushing(false); }
    }, 1500);
    return () => { cancelled = true; clearTimeout(t); };
    // Only re-run when online flips or queue grows from 0 → 1+. We
    // intentionally don't include `entries.length` reactively because
    // the drain itself shrinks the queue (would loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, entries.length > 0]);

  async function flush() {
    setFlushing(true);
    try {
      const result = await drain();
      if (result.drained > 0) setLastDrainResult({ ...result, at: Date.now() });
      return result;
    } finally { setFlushing(false); }
  }

  function acknowledgeDrain() {
    setLastDrainResult(null);
  }

  return { entries, online, flushing, lastDrainResult, flush, acknowledgeDrain };
}
