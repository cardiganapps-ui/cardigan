// Native Google Sign In via @capgo/capacitor-social-login.
//
// On iOS native, Google sign-in goes through the system Google Sign-In
// SDK (a native account picker), which returns an OIDC identity token we
// hand to supabase.auth.signInWithIdToken({ provider: "google", ... }).
// The OAuth-redirect flow (signInWithOAuth) can't be used in the native
// shell because its redirect target is capacitor://localhost, which the
// browser round-trip can't deep-link back to — the same reason Apple
// uses a native plugin here (see nativeAppleSignIn.js).
//
// On web (and Android) we keep Supabase's OAuth redirect flow; only iOS
// branches into this module.
//
// Client IDs are PUBLIC OAuth identifiers (they ship inside the IPA and
// are visible in every OAuth request) — safe to hard-code, same as the
// Firebase config plist. The web client SECRET is NOT here; it lives only
// in Supabase's provider config.
//
// Nonce: unlike Apple, Google does NOT hash the nonce, and propagating a
// nonce through the native SDK into the ID token is the most fragile part
// to get right. We deliberately skip it and rely on Supabase's
// external_google_skip_nonce_check=true. Safe because the iOS client ID
// is bound to the app's bundle ID, so only this app can mint tokens for
// it. This does not weaken the web flow (which uses code exchange, not an
// ID token).

import { isNative, isIOS } from "./platform";

// Public OAuth client identifiers (Google Cloud project 17610829726).
const GOOGLE_IOS_CLIENT_ID =
  "17610829726-9vvfcimk2cbm9eupkaet7k04qlsr33c6.apps.googleusercontent.com";
const GOOGLE_WEB_CLIENT_ID =
  "17610829726-a377pn7cipmftqeje5ch8rknl5jmn11o.apps.googleusercontent.com";

// initialize() must run once before login(). Guarded so repeated
// sign-in attempts don't re-init the native SDK.
let _initialized = false;
async function ensureInit(SocialLogin) {
  if (_initialized) return;
  await SocialLogin.initialize({
    google: {
      iOSClientId: GOOGLE_IOS_CLIENT_ID,
      // serverClientId / webClientId — the audience Supabase treats as
      // primary. Online mode returns the ID token we need.
      webClientId: GOOGLE_WEB_CLIENT_ID,
      mode: "online",
    },
  });
  _initialized = true;
}

export async function signInWithGoogleNative() {
  if (!isNative() || !isIOS()) return { ok: false, code: "unsupported" };

  let SocialLogin;
  try {
    ({ SocialLogin } = await import("@capgo/capacitor-social-login"));
  } catch {
    return { ok: false, code: "unsupported" };
  }

  try {
    await ensureInit(SocialLogin);
    const res = await SocialLogin.login({ provider: "google", options: {} });
    // Online mode returns { provider, result: { idToken, accessToken, ... } }.
    const idToken = res?.result?.idToken;
    if (!idToken) return { ok: false, code: "no-token" };
    return { ok: true, idToken };
  } catch (err) {
    const msg = err?.message || String(err || "");
    // The native picker dismiss surfaces as a cancel-ish error; treat it
    // as a silent no-op, not a red error on the auth screen.
    if (/cancel|canceled|cancelled|dismiss|user/i.test(msg)) {
      return { ok: false, code: "user-cancelled" };
    }
    return { ok: false, code: "failed", error: msg };
  }
}
