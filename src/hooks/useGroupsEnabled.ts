import { useState, useEffect, useCallback } from "react";

/* ── useGroupsEnabled ─────────────────────────────────────────────────
   The Groups feature toggle (Settings → Funciones), extracted from
   AppShell. Per-user, persisted in localStorage, default ON. When OFF the
   entire Groups surface is hidden and the app behaves exactly as it did
   pre-Groups. Users can only turn it OFF when they have zero groups
   (enforced in Settings).

   Keyed by user id so it re-reads on account switch and writes under the
   per-user key. Private-mode localStorage failures fall back to ON (read)
   / no-op (write), never throwing. */

export function useGroupsEnabled(userId: string | null | undefined) {
  const [groupsEnabled, setGroupsEnabledState] = useState(true);
  useEffect(() => {
    // Read the persisted per-user flag on mount / account switch. Single
    // setState (computed first) so the read is one synchronous write — the
    // standard "hydrate from an external store on key change" pattern.
    let next = true;
    if (userId) {
      try {
        const v = localStorage.getItem(`cardigan.groupsEnabled.${userId}`);
        next = v === null ? true : v !== "false";
      } catch { next = true; }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGroupsEnabledState(next);
  }, [userId]);
  const setGroupsEnabled = useCallback((val: boolean) => {
    setGroupsEnabledState(val);
    try { if (userId) localStorage.setItem(`cardigan.groupsEnabled.${userId}`, String(val)); } catch { /* private mode */ }
  }, [userId]);
  return { groupsEnabled, setGroupsEnabled };
}
