import { useEffect, useRef } from "react";

/* ── useFocusRefresh ──────────────────────────────────────────────────
   Lightweight multi-device sync. Whenever the document becomes visible
   after being hidden for ≥ `minHiddenMs`, call the provided refresh
   function. Catches the 90% case where a therapist edits on one device
   and switches to another — the foregrounded tab pulls fresh data
   automatically instead of waiting for a manual reload.

   Why not full Supabase realtime? Realtime requires per-table channel
   subscriptions, reconnect/backoff handling, optimistic-update echo
   suppression, and PWA-lifecycle bookkeeping — substantial complexity
   that's only marginal value over "refresh on focus" given Cardigan's
   workflow (therapists rarely have two tabs editing the same patient
   simultaneously). Visibility-driven refresh delivers most of the win
   with none of the surface area.

   Safeguards:
     • `minHiddenMs` debounces tab-switching in a single session
       (default 10s — short tab flips don't trigger a refetch)
     • `mutating` flag suppresses refresh while an optimistic mutation
       is in flight, so we don't clobber the user's pending change
       with the pre-edit DB state
     • Refs hold mutable state so the listener is attached once per
       refresh-identity change, not on every `mutating` flip

   Returns nothing; effect-only.
*/
export function useFocusRefresh(refresh, { mutating, minHiddenMs = 10_000 } = {}) {
  const hiddenSinceRef = useRef(null);
  const mutatingRef = useRef(mutating);
  useEffect(() => { mutatingRef.current = mutating; }, [mutating]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (typeof refresh !== "function") return;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        // First hide moment — start the clock.
        hiddenSinceRef.current = Date.now();
        return;
      }
      // visible
      const hiddenSince = hiddenSinceRef.current;
      hiddenSinceRef.current = null;
      // First paint or no prior hide — skip.
      if (!hiddenSince) return;
      // Short tab flip — skip to avoid thrashing.
      if (Date.now() - hiddenSince < minHiddenMs) return;
      // Don't clobber an in-flight optimistic mutation.
      if (mutatingRef.current) return;
      // Swallow errors; refresh has its own error surface (setFetchError).
      refresh().catch(() => { /* surfaced via useCardiganData state */ });
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh, minHiddenMs]);
}
