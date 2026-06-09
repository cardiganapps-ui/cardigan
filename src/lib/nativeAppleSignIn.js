// Native Apple Sign In via the Capawesome Capacitor plugin.
//
// We previously used @capacitor-community/apple-sign-in@7.1.0 but that
// release was pinned to Capacitor 7's Swift PM and didn't resolve
// against the Capacitor 8 plugin graph (CI build "Could not resolve
// package dependencies"). Capawesome maintains a Capacitor-8-compatible
// equivalent (peer dep @capacitor/core >=8.0.0) with the same Apple
// system-authorization-sheet UX on iOS.
//
// On iOS native, Apple Sign In MUST go through the system authorization
// sheet (UIKit's ASAuthorizationController under the hood). Going
// through Supabase's OAuth-redirect flow technically works but reads
// as a second-class iOS experience and App Store reviewers consistently
// flag it.
//
// On web and Android we keep using Supabase's OAuth redirect flow
// (signInWithOAuth({ provider: 'apple' })); only iOS branches here.

import { isNative, isIOS } from "./platform";

// Random URL-safe nonce. Apple binds the returned identity token to the
// nonce we send, which defeats token-replay attacks.
function randomNonce(length = 32) {
  const charset = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-._";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) out += charset[bytes[i] % charset.length];
  return out;
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function signInWithAppleNative() {
  if (!isNative() || !isIOS()) return { ok: false, code: "unsupported" };

  let AppleSignIn, SignInScope;
  try {
    ({ AppleSignIn, SignInScope } = await import("@capawesome/capacitor-apple-sign-in"));
  } catch {
    return { ok: false, code: "unsupported" };
  }

  try {
    // Nonce handshake (the documented Supabase native-Apple pattern):
    //   1. generate a raw nonce
    //   2. send its SHA-256 hash to Apple as the request nonce — Apple
    //      echoes that hash into the identity token's `nonce` claim
    //   3. hand the RAW nonce to supabase.auth.signInWithIdToken, which
    //      re-hashes it and matches it against the token's claim.
    // Passing `undefined` (the previous behaviour) only worked if Apple
    // happened to omit the claim; any mismatch fails token validation and
    // breaks the "Sign in with Apple" button — an automatic App Store
    // rejection. Doing the handshake explicitly removes that risk.
    const rawNonce = randomNonce();
    const hashedNonce = await sha256Hex(rawNonce);

    // iOS doesn't require initialize() — the plugin reads the bundle's
    // Sign-In-with-Apple capability directly. scopes is an enum array,
    // not the legacy space-separated string. Names + email come back
    // ONLY on the first authorization for this Apple ID + app pairing;
    // subsequent sign-ins get null for both (the underlying Apple
    // record persists in Supabase auth.users either way).
    const result = await AppleSignIn.signIn({
      scopes: [SignInScope.Email, SignInScope.FullName],
      nonce: hashedNonce,
    });

    const idToken = result?.idToken;
    if (!idToken) return { ok: false, code: "no-token" };

    return {
      ok: true,
      identityToken: idToken,
      nonce: rawNonce,
      givenName: result?.fullName?.givenName,
      familyName: result?.fullName?.familyName,
      email: result?.email,
    };
  } catch (err) {
    // ErrorCode.canceled is exported by the plugin for user-dismiss;
    // anything else is a real failure worth surfacing.
    const msg = err?.message || String(err || "");
    if (/cancel/i.test(msg) || err?.code === "canceled") {
      return { ok: false, code: "user-cancelled" };
    }
    return { ok: false, code: "failed", error: msg };
  }
}
