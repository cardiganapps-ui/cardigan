/* ── Passkeys (WebAuthn) feature gate ─────────────────────────────────
   Cardigan supports passkeys as an additional, passwordless login
   option on TOP of email/password, Sign in with Apple, and magic link.
   It's built on Supabase Auth's passkey beta (supabase.auth.* — see
   src/supabaseClient.js for the experimental opt-in).

   Two independent gates must BOTH pass before any passkey UI renders:

   1. VITE_PASSKEYS_UI_ENABLED — a build-time Vite flag (Vercel env).
      Default OFF. Keeps the buttons hidden until the Supabase dashboard
      side is live (Authentication → Passkeys: RP ID = cardigan.mx,
      RP Origins = https://cardigan.mx). Without that config the WebAuthn
      ceremony 4xxs, so we must not show the control first. Mirrors the
      VITE_WHATSAPP_UI_ENABLED pattern (live-but-inert until flipped).

   2. passkeysSupported() — a runtime WebAuthn capability check. Passkeys
      need `window.PublicKeyCredential`. On the web app the page origin
      IS https://cardigan.mx, so the WebAuthn call matches the RP ID
      directly. Inside the native iOS WebView the page origin is
      capacitor://localhost (which can't claim cardigan.mx), so we install
      the @capgo/capacitor-passkey shim at boot (src/lib/nativePasskeyShim.js)
      which forwards navigator.credentials to native ASAuthorization
      against the cardigan.mx passkey — same Supabase credential store as
      web. See docs/passkeys-native-plan.md.

      Android is deliberately excluded: its WebAuthn clientDataJSON origin
      is the app signature (android:apk-key-hash:…), which Supabase's
      strict origin check (webauthn_rp_origins = https://cardigan.mx)
      rejects. Android keeps password / OAuth.

   Flip VITE_PASSKEYS_UI_ENABLED=true in Vercel (Production + Preview)
   and redeploy once the Supabase dashboard config is in place. */

import { isNative, isIOS } from "../lib/platform";

export const PASSKEYS_UI_ENABLED =
  import.meta.env.VITE_PASSKEYS_UI_ENABLED === "true";

// Runtime support probe. Cheap + synchronous — safe to call in render.
// WKWebView (iOS 16+) and modern browsers both expose PublicKeyCredential;
// the native ceremony is made to work by the boot-time shim. Native is
// limited to iOS (Android origin mismatch, see header).
export function passkeysSupported() {
  if (typeof window === "undefined") return false;
  if (typeof window.PublicKeyCredential !== "function") return false;
  if (isNative()) return isIOS();
  return true;
}

// Single source of truth the UI calls: both gates must pass.
export function passkeysAvailable() {
  return PASSKEYS_UI_ENABLED && passkeysSupported();
}
