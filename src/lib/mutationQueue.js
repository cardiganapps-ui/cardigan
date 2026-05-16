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

import { kvGet, kvSet, kvAvailable } from "./idbKv.js";

const QUEUE_KEY = "mutation_queue_v1";

// Registry of op handlers. Caller modules register at import time.
const HANDLERS = new Map();

// Subscribers receive (entries[]). Notified on every mutation +
// after drain.
const subscribers = new Set();

// In-memory mirror of the persisted queue. Source of truth for
// subscribers (sync reads). Loaded from IDB on init.
let entries = [];
let ready = false;
let loadPromise = null;

// Listener-side handler for replayed entries. Receives (entry, result)
// where result is the handler's return value. Used to bridge replay
// success back to React state (temp-id swap, etc.).
const replayListeners = new Set();

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
    entries = Array.isArray(stored) ? stored : [];
    ready = true;
  })();
  return loadPromise;
}

async function persist() {
  if (!(await kvAvailable())) return;
  await kvSet(QUEUE_KEY, entries);
}

function notify() {
  for (const fn of subscribers) {
    try { fn([...entries]); } catch { /* swallow — subscriber bugs shouldn't break drain */ }
  }
}

export function registerHandler(op, handler) {
  HANDLERS.set(op, handler);
}

export function subscribe(fn) {
  subscribers.add(fn);
  // Immediately deliver current snapshot when subscribing.
  if (ready) fn([...entries]);
  return () => subscribers.delete(fn);
}

export function onReplay(fn) {
  replayListeners.add(fn);
  return () => replayListeners.delete(fn);
}

export async function init() {
  await load();
  notify();
}

export function getEntries() {
  return [...entries];
}

export async function enqueue(op, args, optimisticMeta) {
  await load();
  const entry = {
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
  return entry;
}

// In-flight guard so two simultaneous drain() calls (e.g. reconnect
// + page-focus-refresh) don't double-run handlers.
let draining = false;

export async function drain() {
  await load();
  if (draining) return { drained: 0, remaining: entries.length };
  draining = true;
  let drainedCount = 0;
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
      let result;
      try {
        result = await handler(entry.args, entry);
      } catch (err) {
        result = { error: { message: err?.message || String(err) } };
      }
      if (result && result.error) {
        // Bail and let the next reconnect/focus retry. Keep the entry
        // at the head of the queue so order is preserved.
        entry.attempts += 1;
        entry.lastError = result.error.message || "unknown";
        await persist();
        notify();
        break;
      }
      // Success — pop, notify replay listeners (for state reconciliation),
      // persist, continue.
      entries.shift();
      drainedCount += 1;
      for (const fn of replayListeners) {
        try { fn(entry, result); } catch { /* swallow */ }
      }
      await persist();
      notify();
    }
  } finally {
    draining = false;
  }
  return { drained: drainedCount, remaining: entries.length };
}

// Test/admin-only: drop all entries. Production code should never
// call this — it's the equivalent of `git reset --hard`.
export async function clearForTest() {
  entries = [];
  await persist();
  notify();
}
