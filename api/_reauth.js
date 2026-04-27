import { createClient } from "@supabase/supabase-js";

/* ── Step-up authentication helper ──
   Sensitive endpoints (export-user-data, delete-my-account) require
   the caller to re-prove password possession on top of a valid JWT.
   This protects against an attacker who steals a session token via
   XSS or a stolen device — they can do everything the app supports,
   but they can't exfil the full data export or destroy the account
   without also knowing the password.

   verifyPasswordReauth verifies the supplied password against
   Supabase Auth using the anon client (signInWithPassword). The
   resulting transient session is discarded — we only care about the
   pass/fail signal.

   Limitations:
   - OAuth-only users (no email provider identity) have no password
     to verify. Return code: "oauth_only" so the UI can route them
     to "set a password first" before retrying. */

export async function verifyPasswordReauth({ user, password }) {
  if (!user?.email) return { ok: false, code: "no_email" };
  if (typeof password !== "string" || !password) {
    return { ok: false, code: "password_required" };
  }

  const hasEmailIdentity = Array.isArray(user.identities)
    && user.identities.some(i => i.provider === "email");
  if (!hasEmailIdentity) {
    return { ok: false, code: "oauth_only" };
  }

  const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await anon.auth.signInWithPassword({ email: user.email, password });
  // Best-effort sign-out of the transient session. Failure is fine —
  // the local client never persisted it.
  anon.auth.signOut().catch(() => {});

  if (error) return { ok: false, code: "wrong_password" };
  return { ok: true };
}
