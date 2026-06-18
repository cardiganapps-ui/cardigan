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
      need `window.PublicKeyCredential`, and the RP ID (cardigan.mx) only
      matches the page origin on the real web app — NOT inside the native
      Capacitor WebView, which loads from capacitor://localhost. Native
      iOS passkeys are a separate, larger project (see
      docs/passkeys-native-plan.md); until then we hard-hide passkey UI
      on native and the native shell keeps Apple Sign In + password.

   Flip VITE_PASSKEYS_UI_ENABLED=true in Vercel (Production + Preview)
   and redeploy once the dashboard config is in place. */

import { isNative } from "../lib/platform";

export const PASSKEYS_UI_ENABLED =
  import.meta.env.VITE_PASSKEYS_UI_ENABLED === "true";

// Runtime support probe. Cheap + synchronous — safe to call in render.
// We deliberately gate out native here (not just "no PublicKeyCredential")
// because the WebView CAN expose PublicKeyCredential yet still fail the
// RP-ID/origin match against cardigan.mx.
export function passkeysSupported() {
  if (typeof window === "undefined") return false;
  if (isNative()) return false;
  return typeof window.PublicKeyCredential === "function";
}

// Single source of truth the UI calls: both gates must pass.
export function passkeysAvailable() {
  return PASSKEYS_UI_ENABLED && passkeysSupported();
}
