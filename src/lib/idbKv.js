/* ── idbKv.js ─ tiny IndexedDB key-value wrapper ──
   Built for the mutation queue (Phase 1 of offline support). Stores
   small JSON-serializable values keyed by string. Avoids pulling in
   idb-keyval as a dep — the codebase intentionally keeps dependencies
   lean (no UI library, no TS), and this is ~40 lines.

   Single object store ("kv") in a single database ("cardigan"). All
   ops async; reject if IndexedDB is unavailable (e.g. private mode in
   some browsers). Callers should treat "unavailable" as "queue not
   persistable" and fall back to in-memory only.

   Caveat: IndexedDB is per-origin per-browser-profile. Two tabs share
   the same store. Concurrent writes from two tabs are NOT coordinated
   here — the higher-level queue uses a wall-clock ordering and accepts
   minor reorderings during the rare race. */

const DB_NAME = "cardigan";
const STORE = "kv";
const VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === "undefined") {
    dbPromise = Promise.reject(new Error("IndexedDB unavailable"));
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

function tx(mode) {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function asPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function kvGet(key) {
  const store = await tx("readonly");
  return asPromise(store.get(key));
}

export async function kvSet(key, value) {
  const store = await tx("readwrite");
  return asPromise(store.put(value, key));
}

export async function kvDelete(key) {
  const store = await tx("readwrite");
  return asPromise(store.delete(key));
}

export async function kvAvailable() {
  try { await openDb(); return true; } catch { return false; }
}
