/* ── Optimistic-mutation revert primitive (WS-5) ──────────────────────
   Every money mutation in the data hooks follows the same shape:

     1. snapshot the row(s) about to change   (const prev = {...row})
     2. apply an optimistic setState           (hook-specific)
     3. fire the server write
     4. on error → revert to the snapshot       (set(prev => prev.map(…)))

   Step 4 was hand-written at every call site as
     set(prev => prev.map(r => r.id === id ? snapshot : r))
   — and sometimes a multi-id `.map` with a cascade of `if`s, or, in one
   case (Notes, pre-WS-2), forgotten entirely. This module owns step 4 so
   the revert is uniform and impossible to forget.

   Scope: this builds the REVERT closure from already-captured snapshots.
   It deliberately does NOT own step 1 (capture) or step 2 (apply): those
   are interleaved with each hook's version-guard / conflict-reconcile /
   counter-recalc logic, and the snapshots are reused there too. Keeping
   capture in the hook means restoreRows is a pure, trivially-testable
   builder with no hidden state. Inserts (tempId filter) and undoable
   deletes (softDelete commit/undo) keep their own paths — they aren't a
   capture→apply→revert update.

   Restore semantics mirror the hand-written reverts exactly: restore-IF-
   PRESENT. A snapshot is written back only where a row with its id still
   exists; rows removed since capture are not re-added, and absent/empty
   snapshots are skipped. Behaviour is byte-for-byte the `.map` it replaces. */

import type { Dispatch, SetStateAction } from "react";

/** The shape every Cardigan state row carries — keyed by `id`. */
type Identified = { id?: string | null };

/**
 * Build a `revert()` that restores the given snapshot rows in a state array
 * by id. Capture the snapshots (shallow clones) BEFORE the optimistic apply;
 * call the returned function on server error.
 *
 * @param set        the array's React setter
 * @param snapshots  pre-apply row clones (null/undefined/idless entries are skipped)
 */
export function restoreRows<T extends Identified>(
  set: Dispatch<SetStateAction<T[]>>,
  snapshots: Array<T | null | undefined>,
): () => void {
  // Resolve to an id→row map at build time so the returned closure is cheap
  // and captures nothing but the snapshot data. Last write wins if the same
  // id appears twice (matches the cascade-of-ifs precedence at call sites).
  const byId = new Map<string, T>();
  for (const snap of snapshots) {
    if (snap && snap.id) byId.set(snap.id, snap);
  }
  return () => {
    if (byId.size === 0) return;
    set(prev => prev.map(row => (row.id && byId.has(row.id) ? byId.get(row.id)! : row)));
  };
}

/**
 * Compose several reverts (typically one per state array touched by a single
 * mutation — e.g. a payment edit reverts the payment row AND both affected
 * patient counters) into one `revert()`. Runs them in argument order.
 */
export function composeReverts(...reverts: Array<() => void>): () => void {
  return () => {
    for (const revert of reverts) revert();
  };
}
