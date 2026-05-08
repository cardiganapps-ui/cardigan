/* ── inviteTokenStorage ────────────────────────────────────────────
   Stash for the patient-invite token captured from /i/<token>.

   Why localStorage and not sessionStorage:
     The email-verification round-trip opens a NEW tab when the user
     taps the link in their inbox (Mail / Gmail / etc all do this).
     sessionStorage is scoped to ONE tab, so the token captured in
     the original tab is invisible to the verification tab — the
     PatientClaimGate then can't fire and the freshly-signed-up
     patient lands on ProfessionOnboarding (an orphan with no role).
     localStorage survives across tabs AND the email-roundtrip
     redirect, so the verification tab can read the token and fire
     the claim.

   Why a TTL:
     The server-side token expires after 30 days (patient_invites
     migration 051). We mirror that window in localStorage so a
     stale token doesn't linger forever — even though the server
     would reject it, the UI would briefly show "Vinculando…" then
     a "link expired" error, which feels like a regression. Better
     to GC client-side at the same horizon.

   Key shape: JSON-encoded `{ token, savedAt }` so the get path can
   evict expired entries. Plain-string entries from the legacy
   sessionStorage shape are tolerated and treated as non-expiring
   (the server-side check covers them). */

const KEY = "cardigan.patientInviteToken";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function setInviteToken(token) {
  if (typeof window === "undefined" || !token) return;
  try {
    const payload = JSON.stringify({ token, savedAt: Date.now() });
    localStorage.setItem(KEY, payload);
  } catch { /* private mode etc — caller falls back gracefully */ }
}

export function getInviteToken() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    // Plain-string legacy shape (sessionStorage migration). Trust
    // the server expiry on these — they have no savedAt to check
    // against client-side.
    if (!raw.startsWith("{")) return raw;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.token !== "string") return null;
    if (typeof obj.savedAt === "number" && Date.now() - obj.savedAt > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return obj.token;
  } catch {
    return null;
  }
}

export function clearInviteToken() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
    // Also sweep the legacy sessionStorage entry in case a prior
    // session of the app stashed it there. Cheap, idempotent.
    sessionStorage.removeItem(KEY);
  } catch { /* ignore */ }
}
