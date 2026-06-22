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

interface InvitePayload {
  token: string;
  savedAt?: number;
  therapistName?: string;
  therapistProfession?: string;
}

function readPayload(): InvitePayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    // Plain-string legacy shape (sessionStorage migration). Wrap into
    // the modern object form on the way out — caller code expects
    // an object.
    if (!raw.startsWith("{")) return { token: raw, savedAt: 0 };
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.token !== "string") return null;
    if (typeof obj.savedAt === "number" && Date.now() - obj.savedAt > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return obj;
  } catch {
    return null;
  }
}

function writePayload(obj: { token: string; therapistName?: string; therapistProfession?: string }) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...obj, savedAt: Date.now() }));
  } catch { /* private mode etc — caller falls back gracefully */ }
}

export function setInviteToken(token: string | null | undefined) {
  if (!token) return;
  // Preserve any therapist context already attached from a prior
  // PatientClaimScreen preview. This handles the order-of-operations
  // where the URL capture (App.jsx) runs first and the preview
  // attachment (PatientClaimScreen) lands a moment later.
  const existing = readPayload();
  writePayload({
    token,
    therapistName: existing?.token === token ? existing.therapistName : undefined,
    therapistProfession: existing?.token === token ? existing.therapistProfession : undefined,
  });
}

export function getInviteToken() {
  return readPayload()?.token || null;
}

/* Therapist context — captured by PatientClaimScreen after the
   /api/patient-invite-preview fetch resolves. The signup flow reads
   these to personalize the verification email (template branches on
   .Data.therapist_name presence; the profession resolves to a
   gender-neutral field noun like "psicología" or "tutoría"). */
export function attachTherapistContext({ therapistName, therapistProfession }: { therapistName?: string | null; therapistProfession?: string | null }) {
  const cur = readPayload();
  if (!cur?.token) return;
  writePayload({
    token: cur.token,
    therapistName: therapistName || cur.therapistName,
    therapistProfession: therapistProfession || cur.therapistProfession,
  });
}

export function getInviteContext() {
  const p = readPayload();
  if (!p) return null;
  return {
    token: p.token,
    therapistName: p.therapistName || null,
    therapistProfession: p.therapistProfession || null,
  };
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
