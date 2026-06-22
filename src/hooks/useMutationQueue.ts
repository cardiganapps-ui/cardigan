import { useEffect, useRef, useState } from "react";
import { init, subscribe, drain, getEntries } from "../lib/mutationQueue";
import { useConnectivity } from "./useConnectivity";

/* ── useMutationQueue ─ React surface for the offline queue.
   Initializes the queue on mount (loads from IndexedDB), exposes the
   current entry list to subscribers, and auto-drains when connectivity
   is restored.

   Returned shape:
     • entries           — array of queued mutation entries. Empty
                           when the queue is idle.
     • online            — current navigator.onLine state.
     • flushing          — true while drain() is in flight.
     • flush()           — manual trigger (Reintentar button in the
                           offline banner).

   The hook does NOT enqueue — call sites import enqueue() from
   ../lib/mutationQueue directly. This hook owns lifecycle + auto-drain.

   No success-toast bridge: drains succeed silently. The OfflineBanner's
   headline transitions ("Sin conexión" → "Sincronizando…" → vanish)
   are the offline-recovery feedback; the per-save header indicator
   covers normal online saves. Adding a toast on top carpet-bombed
   the editor with "X cambios guardados" every time a snapshot enqueue
   drained — for active editors that meant a toast on every save.
*/
export function useMutationQueue() {
  const [entries, setEntries] = useState<unknown[]>(() => getEntries());
  const [flushing, setFlushing] = useState(false);
  const { online } = useConnectivity();

  // Initialize the queue + subscribe to changes. init() loads from
  // IndexedDB; subscribe() pushes updates on every enqueue / drain
  // step so the UI count is always current.
  useEffect(() => {
    let mounted = true;
    init().then(() => {
      if (mounted) setEntries(getEntries());
    });
    const unsub = subscribe((next: unknown[]) => {
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
    const handler = async (event: MessageEvent) => {
      if (event?.data?.type === "DRAIN_QUEUE_NUDGE") {
        setFlushing(true);
        try { await drain(); } finally { setFlushing(false); }
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
      try { await drain(); } finally { if (!cancelled) setFlushing(false); }
    }, 1500);
    return () => { cancelled = true; clearTimeout(t); };
    // Only re-run when online flips or queue grows from 0 → 1+. We
    // intentionally don't include `entries.length` reactively because
    // the drain itself shrinks the queue (would loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, entries.length > 0]);

  // M1: the effect above keys on the 0↔non-empty boolean, so while we're
  // ALREADY online with a non-empty queue (e.g. a prior entry bailed and
  // is being retried), enqueuing MORE mutations leaves the boolean
  // true→true and schedules no fresh drain — the new work waits for the
  // next reconnect/SW-nudge/manual retry. Add a drain on queue GROWTH,
  // tracked via a ref so a drain that SHRINKS the queue can't re-trigger
  // it (the loop the boolean dep was guarding against). drain()'s own
  // in-flight guard dedupes against the effect above on the 0→1 overlap.
  const prevLenRef = useRef(0);
  useEffect(() => {
    const grew = entries.length > prevLenRef.current;
    prevLenRef.current = entries.length;
    if (!online || !grew || entries.length === 0) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      setFlushing(true);
      try { await drain(); } finally { if (!cancelled) setFlushing(false); }
    }, 1500);
    return () => { cancelled = true; clearTimeout(t); };
     
  }, [online, entries.length]);

  async function flush() {
    setFlushing(true);
    try { return await drain(); }
    finally { setFlushing(false); }
  }

  return { entries, online, flushing, flush };
}
