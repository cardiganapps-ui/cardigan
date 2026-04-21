/* ── pushStore — SW-accessible storage for the resubscribe token ──
   Shared by useNotifications (when a new subscription is accepted by
   the server) and sw.js (when `pushsubscriptionchange` fires and needs
   to authenticate the swap). Uses IndexedDB because the service worker
   can't read localStorage or the Supabase session. Plain no-dep IDB so
   it works identically in window and worker contexts. */

const DB = "cardigan-push";
const STORE = "kv";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function putPushState({ endpoint, resubToken }) {
  const db = await open();
  const store = tx(db, "readwrite");
  await Promise.all([req(store.put(endpoint, "endpoint")), req(store.put(resubToken, "resubToken"))]);
}

export async function getPushState() {
  const db = await open();
  const store = tx(db, "readonly");
  const [endpoint, resubToken] = await Promise.all([
    req(store.get("endpoint")),
    req(store.get("resubToken")),
  ]);
  return { endpoint: endpoint || null, resubToken: resubToken || null };
}

export async function clearPushState() {
  const db = await open();
  const store = tx(db, "readwrite");
  await Promise.all([req(store.delete("endpoint")), req(store.delete("resubToken"))]);
}
