import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Supabase returns this exact message when a user tries to sign in with
// an email that hasn't been verified yet. Detected so the UI can surface
// a "check your inbox / resend" panel instead of a raw error string.
const EMAIL_NOT_CONFIRMED = /email not confirmed/i;

/* Detect a password-recovery landing synchronously at module load time.

   Why module-level: supabase-js processes the URL hash on its first
   internal call (which can happen before our useEffect runs) and CLEANS
   the URL afterwards. By the time `useEffect` reads window.location.hash,
   the recovery indicator is often already gone, so the PASSWORD_RECOVERY
   onAuthStateChange event is the ONLY signal — and a stray timing race
   (event fires before our listener registers) drops it. Reading the URL
   here, before any other module touches it, is the reliable detection.

   We accept either flow shape:
     - implicit:  https://cardigan.mx#access_token=…&type=recovery&…
     - PKCE (less common for recovery): https://cardigan.mx?code=…&type=recovery
   The Supabase Auth verify endpoint always sets `type=recovery` on the
   redirect, so a single substring check is enough. */
const INITIAL_RECOVERY = (() => {
  if (typeof window === "undefined") return false;
  const { hash, search } = window.location;
  return hash.includes("type=recovery") || search.includes("type=recovery");
})();

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Set true while the user is on the password-recovery flow (clicked
  // a link from a "restablecer contraseña" email). Supabase auto-signs
  // them in with a short-lived token at that point, so the app would
  // otherwise drop them into AppShell. The flag lets App.jsx render a
  // dedicated "set new password" screen instead.
  // Initialised from INITIAL_RECOVERY so we catch the case where the
  // URL hash has been cleaned by supabase-js before our listener mounts;
  // the onAuthStateChange handler below latches the same flag for any
  // case where the URL was missed but the event fires anyway.
  const [recoveryMode, setRecoveryMode] = useState(INITIAL_RECOVERY);

  useEffect(() => {
    // If getSession() rejects (network meltdown, supabase outage at boot),
    // we still need to drop out of `loading` — otherwise the app is stuck
    // on the splash forever. Treat a rejection as "no session" so the
    // user lands on the auth screen and can retry by signing in.
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setUser(session?.user ?? null);
        setLoading(false);
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // PASSWORD_RECOVERY fires once when the user lands on the app
      // via a recovery email link. Latch it until the new-password
      // form clears the flag — onAuthStateChange may emit further
      // SIGNED_IN events (token refresh) before we navigate away,
      // and those shouldn't drop the gate.
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Force-refresh the React user state from the server. Used after
  // supabase.auth.updateUser() because supabase-js 2.x doesn't
  // consistently emit USER_UPDATED through onAuthStateChange when
  // only user_metadata changes — without this, components bound to
  // `user` (Settings avatar card, Drawer header) render stale.
  async function refreshUser() {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) return null;
      if (data?.user) setUser(data.user);
      return data?.user ?? null;
    } catch (_) {
      return null;
    }
  }

  // captchaToken is supplied by the AuthScreen Turnstile widget when
  // VITE_TURNSTILE_SITE_KEY is set. Supabase Auth verifies it server-
  // side against `security_captcha_secret`. When the env isn't wired
  // (local dev, or before the operator finishes setup), captchaToken
  // is undefined and the call goes through unchallenged — matching the
  // current behaviour. Once Supabase's captcha enforcement is on, an
  // unchallenged call returns a 400 and the UI must surface the widget.
  async function signUp({ email, password, name, captchaToken }) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name }, captchaToken },
    });
    if (error) return { error: error.message };
    // With email verification on (mailer_autoconfirm=false), signUp returns
    // no session. Don't attempt a silent signInWithPassword — it would fail
    // with "Email not confirmed" and mask the real next step. Surface a
    // verification signal so the UI can show the "check your inbox" panel.
    if (!data.session) return { pendingVerification: true, email };
    return { data };
  }

  async function signIn({ email, password, captchaToken }) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email, password,
      options: { captchaToken },
    });
    if (error) {
      if (EMAIL_NOT_CONFIRMED.test(error.message)) {
        return { pendingVerification: true, email };
      }
      return { error: error.message };
    }
    return { data };
  }

  /* Sign out and wipe SW caches.

     scope: "local"  (default) — invalidates only this device's session.
     scope: "global"            — revokes EVERY refresh token tied to this
                                   user, kicking them out of every browser
                                   they're signed in on. Use from Settings'
                                   "Cerrar sesión en todos los dispositivos"
                                   for the lost-device recovery flow.

     Cache wipe: SW responses to /api/* are intentionally not cached, but
     the precache holds app shell + assets that may have been customised
     for the prior user (e.g. avatar URLs baked into rendered HTML on a
     stale tab). Easiest, safest path: delete every Cache Storage bucket
     on sign-out. The next page load repopulates from the network. */
  async function signOut(scope = "local") {
    try { await supabase.auth.signOut({ scope }); }
    finally { await wipeBrowserCaches(); }
  }

  async function wipeBrowserCaches() {
    if (typeof caches === "undefined") return;
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch { /* private mode / Lockdown — no-op */ }
  }

  // OAuth providers (Google, Apple) use a full-page redirect to the provider
  // and back to the app. Supabase handles the session exchange on return;
  // the onAuthStateChange listener above picks it up automatically.
  async function signInWithProvider(provider) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) return { error: error.message };
    return {};
  }

  /* Set a new password during the recovery flow.
     Supabase auto-signed the user in with the recovery token so this
     call succeeds without re-auth. After it lands we deliberately
     sign out so they re-login with the freshly-set credential —
     leaves no ambient "signed via reset link" session behind. */
  async function setNewPassword(password) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: error.message };
    setRecoveryMode(false);
    await signOut();
    return { ok: true };
  }

  return { user, loading, recoveryMode, signUp, signIn, signOut, signInWithProvider, refreshUser, setNewPassword };
}
