/* ── mutationQueue.js ─ offline mutation queue (Phase 1) ──
   Persists outbound writes when navigator.onLine === false (or when a
   write fails with a network-class error) and drains them in order on
   reconnect. Entries are JSON-serializable so they survive page
   reloads.

   Architecture:
     • Each op type has a registered HANDLER — an async function that
       takes the persisted args and returns { error } | { data, error }.
       Handlers live in the calling hook (registered at startup) so the
       queue doesn't need to import supabase or know about Cardigan's
       domain shapes.
     • Entries persist as a JSON array under a single key in idbKv.
       Pulled fully into memory on subscribe and rewritten on every
       mutation — fine for the scale of "a few hundred queued ops max".
     • Subscribers receive the current entry list. Used by the offline
       banner to render the pending count.

   Semantics:
     • enqueue(op, args, optimisticMeta?) appends. `optimisticMeta` is
       a free-form object the caller can stash to bridge replay results
       back to React state (e.g. tempId → realId swap). Persisted too.
     • drain() iterates entries in order. On handler success, the
       entry is removed. On handler error, the entry stays and drain()
       bails — the next reconnect tick retries.
     • replayResult is dispatched per successful drain so callers can
       reconcile React state (swap temp IDs, etc.).

   Offline-vs-online conflict tradeoff (documented):
     Replays do NOT carry the version_at_enqueue. If a concurrent
     online write bumped the row server-side while this device was
     offline, the queued mutation wins on replay (last-write-wins).
     This is intentional — the user already saw their offline state
     and expects it to persist. Online concurrent writes are protected
     by the F-tier optimistic locking; offline replays bypass.
*/

import { kvGet, kvSet, kvAvailable } from "./idbKv";

const QUEUE_KEY = "mutation_queue_v1";
// Entries that fail to drain this many times in a row are moved OUT of the
// head of the queue into a preserved dead-letter list, so one permanently-
// failing write (a check-constraint violation, a deleted parent row, an
// RLS change) can't wedge every later mutation behind it forever. The
// entry is never discarded — it stays recoverable via getDeadLetter() /
// retryDeadLetter(). Transient (network) failures recover well within this
// budget across reconnect/focus drains.
const MAX_DRAIN_ATTEMPTS = 5;
const DEADLETTER_KEY = "mutation_queue_deadletter_v1";

// Structural validation for entries loaded from persistence — a malformed
// args/op (corrupted IDB, a partial write) must not be fed to a handler.
function isValidEntry(e: unknown): e is QueueEntry {
  return !!e && typeof e === "object"
    && typeof (e as QueueEntry).id === "string"
    && typeof (e as QueueEntry).op === "string"
    && "args" in (e as object);
}

/** A persisted outbound write awaiting drain. */
export interface QueueEntry {
  id: string;
  op: string;
  args: unknown;
  /* Free-form bridge object the caller stashes to reconcile replay
     results back to React state (e.g. tempId → realId). Each caller
     knows its own shape; typed `any` so replay listeners can read their
     fields without the queue enumerating every caller's contract. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  optimisticMeta: any;
  createdAt: number;
  attempts: number;
  lastError: string | null;
}

/** The result shape a handler resolves to — mirrors a Supabase response
    so the drain loop can reconcile uniformly. */
export interface HandlerResult {
  data?: unknown;
  error?: { message?: string } | null;
  conflict?: boolean;
}

/* Handler args are op-specific shapes the queue itself can't know about
   (each caller registers a typed handler and casts at its own boundary),
   so the registry param is intentionally `any`. Mirrors the loose-edge
   pattern used across the data layer. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueueHandler = (args: any, entry: QueueEntry) => Promise<HandlerResult> | HandlerResult;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReplayListener = (entry: QueueEntry, result: any) => void;
type Subscriber = (entries: QueueEntry[]) => void;

// Registry of op handlers. Caller modules register at import time.
const HANDLERS = new Map<string, QueueHandler>();

// Subscribers receive (entries[]). Notified on every mutation +
// after drain.
const subscribers = new Set<Subscriber>();

// In-memory mirror of the persisted queue. Source of truth for
// subscribers (sync reads). Loaded from IDB on init.
let entries: QueueEntry[] = [];
// Entries that exhausted MAX_DRAIN_ATTEMPTS. Preserved (not discarded) so a
// failed money write is never silently lost and can be surfaced/retried.
let deadLetter: QueueEntry[] = [];
let ready = false;
let loadPromise: Promise<void> | null = null;

// Listener-side handler for replayed entries. Receives (entry, result)
// where result is the handler's return value. Used to bridge replay
// success back to React state (temp-id swap, etc.).
const replayListeners = new Set<ReplayListener>();

let monotonicCounter = 0;
function nextId() {
  monotonicCounter += 1;
  return `q-${Date.now()}-${monotonicCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

async function load() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    if (!(await kvAvailable())) {
      // IDB unavailable (private mode, old browser). Run in-memory
      // only — queue won't survive reloads. Acceptable degradation.
      entries = [];
      ready = true;
      return;
    }
    const stored = await kvGet(QUEUE_KEY);
    // Validate each entry's shape — a structurally-broken entry can't be
    // drained and would otherwise sit at the head and wedge the queue.
    entries = Array.isArray(stored) ? stored.filter(isValidEntry) : [];
    const storedDL = await kvGet(DEADLETTER_KEY);
    deadLetter = Array.isArray(storedDL) ? storedDL.filter(isValidEntry) : [];
    ready = true;
  })();
  return loadPromise;
}

async function persist() {
  if (!(await kvAvailable())) return;
  await kvSet(QUEUE_KEY, entries);
}

async function persistDeadLetter() {
  if (!(await kvAvailable())) return;
  await kvSet(DEADLETTER_KEY, deadLetter);
}

function notify() {
  for (const fn of subscribers) {
    try { fn([...entries]); } catch { /* swallow — subscriber bugs shouldn't break drain */ }
  }
}

export function registerHandler(op: string, handler: QueueHandler) {
  HANDLERS.set(op, handler);
}

export function subscribe(fn: Subscriber) {
  subscribers.add(fn);
  // Immediately deliver current snapshot when subscribing.
  if (ready) fn([...entries]);
  return () => { subscribers.delete(fn); };
}

export function onReplay(fn: ReplayListener) {
  replayListeners.add(fn);
  return () => { replayListeners.delete(fn); };
}

export async function init() {
  await load();
  notify();
}

export function getEntries() {
  return [...entries];
}

// Entries that exhausted their drain attempts and were set aside. Surface
// these so the user can be told "N changes couldn't sync" rather than them
// vanishing silently.
export function getDeadLetter() {
  return [...deadLetter];
}

// Move all dead-lettered entries back to the active queue (attempts reset)
// for another drain — e.g. after the user fixes the underlying cause or a
// deploy ships a corrected handler. Returns how many were re-queued.
export async function retryDeadLetter(): Promise<number> {
  await load();
  if (deadLetter.length === 0) return 0;
  const revived = deadLetter.map((e) => ({ ...e, attempts: 0, lastError: null }));
  entries.push(...revived);
  deadLetter = [];
  await persist();
  await persistDeadLetter();
  notify();
  return revived.length;
}

/** Cancel a not-yet-drained optimistic mutation by its tempId — removes
    any active AND dead-lettered entry whose optimisticMeta.tempId
    matches. Use when the user deletes an offline-created row before it
    drains, so the original insert never resurrects in the DB on
    reconnect. Returns how many entries were removed. */
export async function removeByTempId(tempId: string): Promise<number> {
  if (!tempId) return 0;
  await load();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const match = (e: QueueEntry) => !!(e.optimisticMeta as any) && (e.optimisticMeta as any).tempId === tempId;
  const before = entries.length + deadLetter.length;
  entries = entries.filter((e) => !match(e));
  deadLetter = deadLetter.filter((e) => !match(e));
  const removed = before - (entries.length + deadLetter.length);
  if (removed > 0) {
    await persist();
    await persistDeadLetter();
    notify();
  }
  return removed;
}

/** Patch the args of a not-yet-drained optimistic mutation by its
    tempId. Use when the user EDITS an offline-created row before it
    drains, so the queued insert lands with the edited values instead of
    enqueuing a doomed UPDATE keyed by a non-UUID temp id. `mutator`
    receives the entry's current args and returns the replacement.
    Returns true if a matching entry was patched. */
export async function updateByTempId(
  tempId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutator: (args: any) => any,
): Promise<boolean> {
  if (!tempId) return false;
  await load();
  let changed = false;
  entries = entries.map((e) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((e.optimisticMeta as any) && (e.optimisticMeta as any).tempId === tempId) {
      changed = true;
      return { ...e, args: mutator(e.args) };
    }
    return e;
  });
  if (changed) {
    await persist();
    notify();
  }
  return changed;
}

export async function enqueue(op: string, args: unknown, optimisticMeta?: unknown): Promise<QueueEntry> {
  await load();
  const entry: QueueEntry = {
    id: nextId(),
    op,
    args,
    optimisticMeta: optimisticMeta || null,
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
  };
  entries.push(entry);
  await persist();
  notify();
  // Best-effort Background Sync registration. When the browser
  // implements SyncManager (Chromium-based) and the page is
  // controlled by the SW, registering a tag causes the SW's `sync`
  // event to fire on reconnect — even if the tab is backgrounded.
  // The SW broadcasts a DRAIN_QUEUE_NUDGE to all clients (see sw.js).
  // Safari + Firefox don't implement SyncManager — the existing
  // reconnect-based drain in useMutationQueue still runs.
  try {
    if (typeof navigator !== "undefined" && navigator.serviceWorker && "SyncManager" in (globalThis.window || {})) {
      const reg = await navigator.serviceWorker.ready as unknown as { sync?: { register: (tag: string) => Promise<void> } };
      if (reg && reg.sync) await reg.sync.register("cardigan-drain-queue");
    }
  } catch { /* permissions / unsupported — fallback path runs anyway */ }
  return entry;
}

// In-flight guard so two simultaneous drain() calls (e.g. reconnect
// + page-focus-refresh) don't double-run handlers.
let draining = false;

export async function drain() {
  await load();
  if (draining) return { drained: 0, remaining: entries.length, conflicts: 0 };
  draining = true;
  let drainedCount = 0;
  let conflictsCount = 0;
  try {
    while (entries.length > 0) {
      const entry = entries[0];
      const handler = HANDLERS.get(entry.op);
      if (!handler) {
        // Unknown op — leave it so a future deploy with the handler
        // can pick it up. Bail this round.
        entry.lastError = `no handler for op "${entry.op}"`;
        await persist();
        notify();
        break;
      }
      let result: HandlerResult;
      try {
        result = await handler(entry.args, entry);
      } catch (err) {
        result = { error: { message: (err as Error)?.message || String(err) } };
      }
      if (result && result.error) {
        entry.attempts += 1;
        entry.lastError = result.error.message || "unknown";
        if (entry.attempts >= MAX_DRAIN_ATTEMPTS) {
          // Poison pill: this entry has failed MAX_DRAIN_ATTEMPTS times.
          // A transient (network) failure would have cleared long ago, so
          // it's almost certainly permanent (check-constraint, deleted
          // parent, RLS). Move it to the preserved dead-letter list and
          // CONTINUE so the independent mutations queued behind it still
          // land — instead of wedging the whole queue at the head forever.
          // The entry is kept (recoverable via getDeadLetter/retryDeadLetter),
          // never discarded.
          entries.shift();
          deadLetter.push(entry);
          await persistDeadLetter();
          await persist();
          notify();
          continue;
        }
        // Transient: bail and let the next reconnect/focus retry. Keep the
        // entry at the head so order is preserved.
        await persist();
        notify();
        break;
      }
      // Success — pop, notify replay listeners (for state reconciliation),
      // persist, continue. Handlers may opt-in to flagging `conflict: true`
      // in the result when they detect that a concurrent online write
      // bumped the row past the version captured at enqueue. The replay
      // still applies (intentional last-write-wins for offline) but the
      // count surfaces in the drain-success toast so the user knows.
      entries.shift();
      drainedCount += 1;
      if (result?.conflict) conflictsCount += 1;
      for (const fn of replayListeners) {
        try { fn(entry, result); } catch { /* swallow */ }
      }
      await persist();
      notify();
    }
  } finally {
    draining = false;
  }
  return { drained: drainedCount, remaining: entries.length, conflicts: conflictsCount };
}

// Test/admin-only: drop all entries. Production code should never
// call this — it's the equivalent of `git reset --hard`.
export async function clearForTest() {
  entries = [];
  deadLetter = [];
  await persist();
  await persistDeadLetter();
  notify();
}
