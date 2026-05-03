/* Stale-while-revalidate cache for the user's primary data
   (patients, sessions, payments, notes, documents, measurements).

   The first paint after a cold start used to block on a Supabase
   round-trip — typically 200-600ms on warm connections, multiple
   seconds on weak networks. With this cache, the previous session's
   data renders immediately and the network refresh happens in the
   background; the UI swaps to fresh data when the fetch completes.

   Storage backend: localStorage. Single key per user
   (cardigan.cache.v1.<userId>) so multi-user sessions on the same
   browser stay isolated. Versioned via the key + an inner `v` field —
   bump the prefix or the inner version when the row shape changes
   incompatibly so stale caches get discarded instead of crashing
   consumers.

   Size envelope: a typical Cardigan account is < 200 patients +
   < 5000 sessions + < 5000 payments + < 500 notes/documents/
   measurements ≈ 1.5 MB serialized. localStorage tops out around
   5 MB per origin so we have headroom; if a write fails we wipe the
   user's slot and skip caching for the rest of the session (the
   network path still works, just no cache speedup).

   Privacy: the cache lives only on the user's own device. Encrypted
   notes stay encrypted (the cached row carries the ciphertext + the
   encrypted flag; decryption happens in useCardiganData against the
   in-memory master key). No new threat surface vs. what's already
   served by the auth-gated Supabase fetch. */

const KEY_PREFIX = "cardigan.cache.v1";
// Cap how stale a cached snapshot is allowed to be. Beyond this, drop
// it and force a fresh fetch — the user's been gone long enough that
// a flash of week-old data would be more confusing than helpful.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function keyFor(userId) {
  return `${KEY_PREFIX}.${userId}`;
}

/* Read the cached snapshot for a user. Returns null when:
   - no userId is provided (logged out / pre-auth render)
   - localStorage isn't available (private mode, SSR)
   - no entry exists, the entry is malformed, or it has expired
   - the embedded uid doesn't match the requested userId (defensive
     guard against a key collision after a refactor)
   The shape mirrors what useCardiganData hydrates into useState:
   { patients, upcomingSessions, payments, notes, documents,
     measurements } plus the metadata fields. */
export function loadCachedData(userId) {
  if (!userId) return null;
  if (typeof localStorage === "undefined") return null;
  let raw;
  try { raw = localStorage.getItem(keyFor(userId)); }
  catch { return null; }
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return null; }
  if (!parsed || parsed.v !== 1 || parsed.uid !== userId) return null;
  if (typeof parsed.ts !== "number" || Date.now() - parsed.ts > MAX_AGE_MS) return null;
  return parsed;
}

/* Persist the latest snapshot for a user. Called after every
   successful `refresh()` in useCardiganData; mutations that change
   in-memory state will flow through the next refresh write. We do
   NOT write per-mutation — that thrashes localStorage for accounts
   with chatty edit flows (rapid status flips, payment edits). */
export function saveCachedData(userId, data) {
  if (!userId) return;
  if (typeof localStorage === "undefined") return;
  const payload = JSON.stringify({
    v: 1,
    uid: userId,
    ts: Date.now(),
    patients:         data.patients || [],
    upcomingSessions: data.upcomingSessions || [],
    payments:         data.payments || [],
    notes:            data.notes || [],
    documents:        data.documents || [],
    measurements:     data.measurements || [],
  });
  try { localStorage.setItem(keyFor(userId), payload); }
  catch {
    // Quota exceeded or storage disabled. Try to free our own slot
    // first — if a stale snapshot from a previous version is taking
    // up the budget, dropping it is harmless. If the second attempt
    // also fails (genuinely full or storage disabled), skip silently;
    // the network fetch still works.
    try { localStorage.removeItem(keyFor(userId)); localStorage.setItem(keyFor(userId), payload); }
    catch { /* give up — uncached this session */ }
  }
}

/* Wipe a user's cache slot. Called from the signout flow so a
   shared device doesn't leak the previous user's data into the
   next browser refresh. */
export function clearCachedData(userId) {
  if (!userId) return;
  if (typeof localStorage === "undefined") return;
  try { localStorage.removeItem(keyFor(userId)); }
  catch { /* nothing to clean up */ }
}
