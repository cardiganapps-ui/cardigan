// Native passkey bridge — installs @capgo/capacitor-passkey's WebAuthn
// shim so the EXISTING Supabase passkey calls work inside the iOS
// WKWebView.
//
// Why this is needed: Supabase's supabase.auth.signInWithPasskey() /
// registerPasskey() drive the ceremony through navigator.credentials.
// In the native WebView the page origin is capacitor://localhost, which
// can't claim the cardigan.mx RP ID, so the browser-level WebAuthn call
// is rejected. autoShimWebAuthn() patches navigator.credentials.{create,
// get} to forward to iOS's native ASAuthorization APIs (Face ID / Touch
// ID against the cardigan.mx passkey, authorized via the
// webcredentials:cardigan.mx associated domain), and — on iOS 17.4+ —
// encodes the configured `origin` (https://cardigan.mx) into
// clientDataJSON so Supabase's verify endpoint accepts the assertion
// against webauthn_rp_origins = "https://cardigan.mx".
//
// Net effect: one passkey, stored in Supabase's GoTrue under RP ID
// cardigan.mx, works on BOTH the web app and the native iOS app. No
// custom server or credential table.
//
// No-op on web (isNative() short-circuits) and on Android (we don't
// surface passkey UI there — Android's clientDataJSON origin is the app
// signature, not https://cardigan.mx, which Supabase would reject).

import { isNative, isIOS } from "./platform";

// The shared HTTPS origin the relying party (Supabase) expects. Must
// match webauthn_rp_origins in the Supabase auth config exactly.
const RP_ORIGIN = "https://cardigan.mx";

// Set true once the shim is confirmed installed, so passkeysSupported()
// can branch on it. Web never reads this (it uses navigator.credentials
// directly); only the native path cares.
let _shimReady = false;
export function isPasskeyShimReady() { return _shimReady; }

export async function initNativePasskeys() {
  // iOS only: Android passkeys would carry an app-signature origin that
  // the server's strict origin check rejects (see file header).
  if (!isNative() || !isIOS()) return;
  try {
    const { CapacitorPasskey } = await import("@capgo/capacitor-passkey");
    // Pass the origin explicitly (belt-and-suspenders alongside the
    // plugins.CapacitorPasskey config block) so the shim doesn't depend
    // on native config parsing succeeding.
    await CapacitorPasskey.autoShimWebAuthn({ origin: RP_ORIGIN });
    _shimReady = true;
    // Let any already-mounted screen know it can now offer passkeys
    // (the AuthScreen may have rendered before this async install
    // resolved). Cheap, fire-and-forget.
    try { window.dispatchEvent(new Event("cardigan-passkey-ready")); } catch { /* ignore */ }
  } catch {
    // Plugin missing / old iOS / shim failure — leave _shimReady false.
    // The passkey UI stays hidden on native (passkeysSupported() gates
    // on the shim), so users fall back to password / Apple cleanly.
    _shimReady = false;
  }
}
