import { useEffect, useState } from "react";
import type { User, Provider } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import { isNative, isIOS } from "../lib/platform";
import { signInWithAppleNative } from "../lib/nativeAppleSignIn";
import { signInWithGoogleNative } from "../lib/nativeGoogleSignIn";
import { clearInviteToken, getInviteContext } from "../utils/inviteTokenStorage";
import { clearCachedData } from "../lib/dataCache";
import { track } from "../lib/analytics";

// Field/discipline nouns (gender-neutral). The verification email
// template uses .Data.therapist_profession to render copy like
// "Atención: Psicología" — neutral and accurate regardless of the
// practitioner's gender. Mirrors PROVIDER_LABELS in
// PatientClaimScreen / PatientHome / IntakeFormSheet.
const PROFESSION_FIELD_ES: Record<string, string> = {
  psychologist:  "psicología",
  nutritionist:  "nutrición",
  trainer:       "entrenamiento personal",
  music_teacher: "clases de música",
  tutor:         "tutoría",
};

// Supabase returns this exact message when a user tries to sign in with
// an email that hasn't been verified yet. Detected so the UI can surface
// a "check your inbox / resend" panel instead of a raw error string.
const EMAIL_NOT_CONFIRMED = /email not confirmed/i;

// Supabase returns a captcha-verification failure when server-side
// `security_captcha_enabled` is ON but the client sent no (or an
// invalid) Turnstile token. On native this is FATAL — the Capacitor
// webview can't run Turnstile at all (capacitor://localhost isn't an
// allowed Turnstile origin), so EVERY native sign-up / sign-in would
// 400 if enforcement is ever flipped on server-side. We classify it to
// a distinct, typed result so the failure is diagnosable (Sentry,
// support) instead of surfacing as a generic red string. The matching
// invariant lives in api/auth-config-check.js, which asserts the
// server flag stays false. See CLAUDE.md "Auth captcha".
const CAPTCHA_ENFORCED = /captcha/i;

// Map a Supabase auth error to our typed captcha result when it's a
// captcha-required failure; otherwise null (caller handles normally).
// The error shape from supabase-js is { message, code? } — match on
// either the documented `captcha_failed` code or any "captcha" message.
export function classifyCaptchaError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return null;
  const code = (error.code || "").toLowerCase();
  const msg = (error.message || "").toLowerCase();
  if (code === "captcha_failed" || CAPTCHA_ENFORCED.test(code) || CAPTCHA_ENFORCED.test(msg)) {
    return {
      error: error.message || "Captcha verification failed",
      code: "captcha_enforced",
    };
  }
  return null;
}

/* Detect a password-recovery / invite landing synchronously at module
   load time.

   Why module-level: supabase-js processes the URL hash on its first
   internal call (which can happen before our useEffect runs) and CLEANS
   the URL afterwards. By the time `useEffect` reads window.location.hash,
   the recovery indicator is often already gone, so the PASSWORD_RECOVERY
   onAuthStateChange event is the ONLY signal — and a stray timing race
   (event fires before our listener registers) drops it. Reading the URL
   here, before any other module touches it, is the reliable detection.

   The Supabase Auth verify endpoint sets `type=recovery` on password
   recovery redirects and `type=invite` on user-invitation redirects;
   both shapes use the URL fragment so a single substring check is
   enough. Invites need the same "set a password before doing anything
   else" gate as recovery — invited users land in an authenticated AAL1
   session with NO password set, so without the gate they could use the
   app once but never sign back in. */
const INITIAL_RECOVERY = (() => {
  if (typeof window === "undefined") return false;
  const { hash, search } = window.location;
  return hash.includes("type=recovery") || search.includes("type=recovery");
})();
const INITIAL_INVITE = (() => {
  if (typeof window === "undefined") return false;
  const { hash, search } = window.location;
  return hash.includes("type=invite") || search.includes("type=invite");
})();

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
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
  // Same idea for invite landings — Supabase fires SIGNED_IN (not a
  // dedicated INVITE event), so we rely entirely on the URL signal we
  // captured at module load. Latched so subsequent token refreshes
  // don't drop the gate.
  const [inviteMode, setInviteMode] = useState(INITIAL_INVITE);

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
  async function signUp({ email, password, name, captchaToken }: { email: string; password: string; name?: string; captchaToken?: string }) {
    // If a patient-invite token is in storage, the user signed up
    // FROM /i/<token>. Three things change when that's the case:
    //   1. emailRedirectTo points back at /i/<token> so the
    //      verification email's link re-stashes the token (defense
    //      in depth on top of localStorage) AND fires the claim
    //      automatically when the user lands signed-in.
    //   2. options.data carries `is_patient: "1"` and the
    //      therapist's name/gendered-profession so the Supabase
    //      auth email template branches on .Data.therapist_name and
    //      sends a patient-tailored verification email instead of
    //      the therapist "tu consultorio en orden" copy.
    //   3. full_name still flows through so the email greets the
    //      patient by name.
    let emailRedirectTo;
    const extraData: Record<string, string> = {};
    try {
      const ctx = getInviteContext();
      if (ctx?.token && typeof window !== "undefined") {
        emailRedirectTo = `${window.location.origin}/i/${encodeURIComponent(ctx.token)}`;
        extraData.is_patient = "1";
        if (ctx.therapistName) extraData.therapist_name = ctx.therapistName;
        const profKey = ctx.therapistProfession || "psychologist";
        extraData.therapist_profession = PROFESSION_FIELD_ES[profKey] || PROFESSION_FIELD_ES.psychologist;
      }
    } catch { /* ignore — fall back to project default */ }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name, ...extraData },
        captchaToken,
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });
    if (error) {
      // Captcha-enforcement drift is the most diagnostically important
      // failure (it breaks ALL native auth), so classify it first.
      const captcha = classifyCaptchaError(error);
      if (captcha) return captcha;
      // Supabase blocks duplicate-email signups itself, but the error
      // message comes back as raw English ("User already registered" /
      // "A user with this email address has already been registered").
      // Surface a typed signal so the UI can render a recovery panel
      // (Iniciar sesión / Restablecer contraseña) instead of dumping a
      // generic error string.
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("already") && (msg.includes("registered") || msg.includes("user"))) {
        return { emailAlreadyRegistered: true, email };
      }
      return { error: error.message };
    }
    // With email verification on (mailer_autoconfirm=false), signUp returns
    // no session. Don't attempt a silent signInWithPassword — it would fail
    // with "Email not confirmed" and mask the real next step. Surface a
    // verification signal so the UI can show the "check your inbox" panel.
    //
    // Supabase quirk: signUp() with an email that ALREADY exists and is
    // confirmed returns a fake user object (id + obfuscated identities)
    // and no session — the same shape as a fresh "check your inbox"
    // response. Detect this by checking if the returned user has any
    // identities (real new signups always do; recycled ones don't).
    // Without this guard, an attacker could re-sign-up someone else's
    // email and we'd render "check your inbox" while no email was
    // actually sent. See:
    //   https://github.com/supabase/auth/issues/1517
    if (!data.session) {
      const identities = data.user?.identities;
      if (Array.isArray(identities) && identities.length === 0) {
        return { emailAlreadyRegistered: true, email };
      }
      // Funnel top: a genuine new account whose verification email was
      // sent. The 30-day in-app trial starts at created_at, so this is
      // the "trial_started" signal. No session/identity yet, so the
      // event is anonymous (no user_id context) by design.
      track("trial_started", { method: "email" });
      return { pendingVerification: true, email };
    }
    return { data };
  }

  async function signIn({ email, password, captchaToken }: { email: string; password: string; captchaToken?: string }) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email, password,
      options: { captchaToken },
    });
    if (error) {
      const captcha = classifyCaptchaError(error);
      if (captcha) return captcha;
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
  async function signOut(scope: string = "local") {
    // Defensive: callers occasionally pass `signOut` directly to an
    // event handler (`onClick={signOut}`) which feeds the synthetic
    // event into `scope`. Supabase rejects anything that isn't one of
    // these three strings — if we get a non-string, fall back to the
    // safe default rather than blowing up the gesture.
    const safeScope = (scope === "local" || scope === "global" || scope === "others")
      ? scope : "local";
    // Capture the uid before the auth listener nulls `user` so we can wipe
    // this user's localStorage data cache (financial rows) below — otherwise
    // the next person to sign in on a shared device sees the previous user's
    // cached patients/payments for a beat before refresh() overwrites them.
    const uid = user?.id;
    // Clear any pending patient-invite token before signing out. A
    // patient who just signed out shouldn't land back on the claim
    // screen with the same token still in storage — they'd see
    // "este enlace ya se usó" because they themselves already
    // redeemed it. Cleanup keeps the post-signout state identical
    // to a fresh visitor.
    clearInviteToken();
    try { await supabase.auth.signOut({ scope: safeScope }); }
    catch (err) {
      // Network / Supabase-side error — log but proceed to wipe local
      // caches and let the auth listener mark the user signed-out
      // anyway. Better the user sees the auth screen than a stuck
      // post-MFA page with no escape.
      console.warn("signOut:", (err as Error)?.message || err);
    }
    finally {
      // localStorage isn't Cache Storage — wipeBrowserCaches() won't touch
      // the data cache, so clear it explicitly here.
      clearCachedData(uid);
      await wipeBrowserCaches();
    }
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
  //
  // Exception: iOS native + Apple → route through the Capacitor Apple
  // Sign In plugin (system authorization sheet) and feed the resulting
  // identity token to supabase.auth.signInWithIdToken. App Store Guideline
  // 4.8 effectively requires this — the OAuth redirect technically works
  // but reviewers consistently flag the second-class UX.
  async function signInWithProvider(provider: Provider) {
    if (provider === "apple" && isNative() && isIOS()) {
      const native = await signInWithAppleNative();
      if (!native.ok) {
        if (native.code === "user-cancelled") return {}; // silent — user dismissed
        return { error: native.error || native.code };
      }
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: native.identityToken!,
        nonce: native.nonce,
      });
      if (error) return { error: error.message };
      // Apple returns the user's name ONLY on the very first authorization
      // for this Apple ID + app — it's gone forever after. Persist it now
      // or the greeting / avatar initial render blank for every Apple
      // signup. Cosmetic, so failures here are non-fatal.
      const fullName = [native.givenName, native.familyName]
        .filter(Boolean).join(" ").trim();
      if (fullName && !data?.user?.user_metadata?.full_name) {
        try { await supabase.auth.updateUser({ data: { full_name: fullName } }); }
        catch { /* non-fatal */ }
      }
      return {};
    }
    // Native + Google → native Google sign-in (iOS: Google SDK account
    // picker; Android: Credential Manager sheet) → signInWithIdToken.
    // Mirrors the Apple branch above; same rationale (the OAuth redirect
    // can't deep-link back to capacitor://localhost). Both platforms
    // return an ID token whose audience is the WEB client ID, which
    // Supabase's external_google_client_id already accepts. No nonce —
    // the project runs external_google_skip_nonce_check=true (see
    // nativeGoogleSignIn.ts for why).
    if (provider === "google" && isNative()) {
      const native = await signInWithGoogleNative();
      if (!native.ok) {
        if (native.code === "user-cancelled") return {}; // silent — user dismissed
        return { error: native.error || native.code };
      }
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: native.idToken!,
      });
      if (error) return { error: error.message };
      return {};
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) return { error: error.message };
    return {};
  }

  /* Passwordless sign-in with a passkey (WebAuthn). Supabase drives the
     full ceremony internally via navigator.credentials and uses
     discoverable credentials, so we pass nothing — the authenticator's
     own UI lets the user pick which account/passkey to use. On success
     the onAuthStateChange listener above picks up the new session
     (SIGNED_IN), same as every other entry point, so there's nothing to
     wire here beyond surfacing an error. A dismissed system sheet throws
     NotAllowedError / AbortError — treat that as a silent cancel, not a
     red error on the auth screen. Gated to web by the caller (the button
     only renders when passkeysAvailable()). */
  async function signInWithPasskey() {
    try {
      const { error } = await supabase.auth.signInWithPasskey();
      if (error) {
        if (/NotAllowed|AbortError|cancel/i.test(error.name || error.message || "")) {
          return {}; // user dismissed the sheet — silent
        }
        return { error: error.message };
      }
      return {};
    } catch (e) {
      if (/NotAllowed|AbortError|cancel/i.test((e as Error)?.name || (e as Error)?.message || "")) return {};
      return { error: (e as Error)?.message };
    }
  }

  /* Set a password during recovery / invite — same code path, different
     entry point. Supabase auto-signed the user in with the recovery /
     invite token so this call succeeds without re-auth. After it lands
     we deliberately sign out so they re-login with the freshly-set
     credential — leaves no ambient "signed via emailed link" session
     behind. */
  /* Passwordless sign-in. Supabase's signInWithOtp emails a one-tap
     magic link and (when type=email) also a 6-digit code as fallback.
     The redirect honors any pending invite token so a patient who
     clicks "Entrar con un enlace" after landing on /i/<token> still
     ends up at the claim flow on return. */
  async function signInWithMagicLink({ email, captchaToken }: { email: string; captchaToken?: string }) {
    const { token: inviteToken } = getInviteContext() || {};
    const redirectTo = inviteToken
      ? `${window.location.origin}/i/${inviteToken}`
      : window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        captchaToken,
        emailRedirectTo: redirectTo,
        // Don't auto-create accounts via magic link. Sign-up flows
        // through the explicit signup form so consent + name capture
        // happen first; magic link is sign-in only.
        shouldCreateUser: false,
      },
    });
    if (error) return { error: error.message };
    return { sent: true, email };
  }

  async function setNewPassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: error.message };
    setRecoveryMode(false);
    setInviteMode(false);
    await signOut();
    return { ok: true };
  }

  return { user, loading, recoveryMode, inviteMode, signUp, signIn, signOut, signInWithProvider, signInWithMagicLink, signInWithPasskey, refreshUser, setNewPassword };
}
