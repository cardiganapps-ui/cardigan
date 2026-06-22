import { useEffect, useState, useRef, useCallback } from "react";

/* ── useAdminQuery ─────────────────────────────────────────────────────
   Stale-while-revalidate cache for admin page data fetches. The first
   visit to a section pays the round-trip cost; every subsequent visit
   in the same session renders the cached payload INSTANTLY and
   revalidates in the background, so flipping between Users / Codes /
   Audit / Overview no longer feels like waiting on the network.

   The cache lives at module scope so it survives unmount/remount but
   is wiped on a page reload (which is correct — the admin can pull-to-
   refresh or hard-reload to get a guaranteed-fresh state).

   Mutations (admin actions like block / grant comp / toggle code)
   call `invalidateAdminCache(prefix)` to drop stale keys, which
   causes the next visit to refetch.

   Usage:
     const { data, loading, error, refetch } = useAdminQuery(
       "users:all",
       fetchAllAccounts,
     );

   Deps for the fetcher (e.g. uid in user-detail) get folded into the
   key so each unique key gets its own cache slot. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const cache = new Map<string, { value: Row; at: number }>(); // key -> { value, at }

export function getCachedValue(key: string) {
  return cache.get(key)?.value;
}

export function setCachedValue(key: string, value: Row) {
  cache.set(key, { value, at: Date.now() });
}

export function invalidateAdminCache(prefix: string) {
  if (!prefix) { cache.clear(); return; }
  for (const k of cache.keys()) {
    if (k === prefix || k.startsWith(prefix + ":")) cache.delete(k);
  }
}

export function useAdminQuery(key: string, fetcher: () => Row | Promise<Row>, { enabled = true }: { enabled?: boolean } = {}) {
  // Hydrate from cache synchronously on first render so the page
  // body paints with real content instead of "Cargando…" when the
  // user revisits a section.
  const [data, setData] = useState(() => (key ? cache.get(key)?.value : undefined));
  const [loading, setLoading] = useState(() => !cache.has(key));
  const [error, setError] = useState("");
  // Bumping this triggers an effect-driven refetch without changing
  // the cache key. Used by `refetch()` and by mutation callbacks.
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  // Sync the ref inside an effect, not during render — the
  // react-hooks/refs lint rule (correctly) bans render-time ref
  // writes. The fetcher is read inside another effect below, so
  // this lands before the next render's read.
  useEffect(() => { fetcherRef.current = fetcher; }, [fetcher]);

  useEffect(() => {
    if (!enabled || !key) return;
    let cancelled = false;
    // If we have cached data, keep loading=false but still revalidate
    // silently in the background. If we don't, show the spinner.
    // The setState calls inside this effect are intentional: the
    // effect is the "external sync point" between the cache + fetch
    // result and the component's own loading/error state.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!cache.has(key)) setLoading(true);
    setError("");
    /* eslint-enable react-hooks/set-state-in-effect */
    Promise.resolve(fetcherRef.current())
      .then((value) => {
        if (cancelled) return;
        setCachedValue(key, value);
        setData(value);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || "Error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [key, enabled, tick]);

  const refetch = useCallback(() => setTick((n) => n + 1), []);

  // Optimistic update: write `next` (or `next(prev)` for a function)
  // to both the local state and the module cache so a subsequent
  // useAdminQuery call with the same key picks up the new value.
  // Callers typically invoke this right after a mutating server
  // action so the row re-renders instantly while the next refetch
  // confirms the truth.
  const mutate = useCallback((updater: Row | ((prev: Row) => Row)) => {
    setData((prev: Row) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (key) setCachedValue(key, next);
      return next;
    });
  }, [key]);

  return { data, loading, error, refetch, mutate };
}
