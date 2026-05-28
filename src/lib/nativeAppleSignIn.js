// Native Apple Sign In via the Capacitor community plugin.
//
// On iOS native, Apple Sign In MUST go through the system authorization
// sheet (UIKit's ASAuthorizationController under the hood). Going through
// Supabase's OAuth-redirect flow technically works but reads as a
// second-class iOS experience — Safari opens, the user authenticates,
// Safari redirects back, and the app re-mounts. The native sheet keeps
// everything in-app and is what App Store reviewers expect to see.
//
// On web and Android we keep using Supabase's OAuth redirect flow
// (signInWithOAuth({ provider: 'apple' })); only iOS branches here.

import { isNative, isIOS } from "./platform";

const APP_BUNDLE_ID = "mx.cardigan.app";

export async function signInWithAppleNative() {
  if (!isNative() || !isIOS()) return { ok: false, code: "unsupported" };

  let SignInWithApple;
  try {
    ({ SignInWithApple } = await import("@capacitor-community/apple-sign-in"));
  } catch {
    return { ok: false, code: "unsupported" };
  }

  try {
    // clientId: on iOS native the system uses the bundle's Sign-In-with-
    //   Apple capability, but the plugin still requires the field. Bundle
    //   ID matches the App ID we registered in Apple Developer Console.
    // redirectURI: unused for native auth (no redirect happens) but the
    //   plugin API requires the field. We pass a marker URL anyway.
    // scopes: 'email name' requests both. Apple may return null for them
    //   if the user previously authorized this app (they only fire on the
    //   FIRST auth) — Supabase persists the user record regardless.
    const result = await SignInWithApple.authorize({
      clientId: APP_BUNDLE_ID,
      redirectURI: "https://cardigan.mx/",
      scopes: "email name",
    });

    const idToken = result?.response?.identityToken;
    if (!idToken) return { ok: false, code: "no-token" };

    return {
      ok: true,
      identityToken: idToken,
      nonce: result?.response?.nonce,
      // The names are only present on first authorization. We pass them
      // through so the caller can stash them on the auth user record.
      givenName: result?.response?.givenName,
      familyName: result?.response?.familyName,
      email: result?.response?.email,
    };
  } catch (err) {
    // 1001 = "Authorization canceled by user" per ASAuthorizationError;
    // anything else is a real failure worth surfacing to the user.
    const code = err?.code || err?.error;
    if (code === "1001" || /cancel/i.test(err?.message || "")) {
      return { ok: false, code: "user-cancelled" };
    }
    return { ok: false, code: "failed", error: err?.message || String(err) };
  }
}
