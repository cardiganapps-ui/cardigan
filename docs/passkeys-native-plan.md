# Passkeys on native iOS — implementation plan (follow-up)

> Status: **NOT built.** Web passkeys shipped first (see "What shipped"
> below). This document scopes the native iOS work so we can decide on
> it deliberately rather than discovering the blockers mid-build.

## TL;DR

Web passkeys "just work" because the app runs on `https://cardigan.mx`,
which matches the WebAuthn **Relying Party (RP) ID** we register with
Supabase. The native iOS app does **not** run on that origin — Capacitor
loads bundled assets from `capacitor://localhost` — so the browser-level
WebAuthn ceremony (`navigator.credentials`, which Supabase's
`signInWithPasskey()` / `registerPasskey()` call internally) is rejected
for RP-ID/origin mismatch inside the WKWebView. Native passkeys therefore
need a different plumbing than web, and it's a real project, not a flag
flip.

## What shipped (web, already on `main`)

- `@supabase/supabase-js` ≥ 2.105 with `auth.experimental.passkey: true`
  (`src/supabaseClient.js`).
- `src/config/passkeys.js` — two gates: `VITE_PASSKEYS_UI_ENABLED`
  (build-time Vercel flag, default OFF) **and** `passkeysSupported()`
  (runtime WebAuthn check that returns **false on native**).
- `usePasskeys` hook, Settings → Seguridad management sheet, a
  "Continuar con passkey" button on the web AuthScreen, and a one-time
  post-login enrollment nudge.
- Because `passkeysSupported()` is false on native, none of the passkey
  UI renders in the iOS app today — the native shell keeps email/password
  + Sign in with Apple. That's intentional and safe.

## Why native is harder (the three blockers)

1. **Origin / RP-ID mismatch.** WebAuthn binds a credential to an RP ID
   (a registrable domain, `cardigan.mx`) and verifies it against the
   page origin. The WKWebView's origin is `capacitor://localhost`, which
   cannot claim `cardigan.mx`. So `navigator.credentials.{create,get}`
   inside the webview won't produce a `cardigan.mx` passkey.

2. **Supabase drives the ceremony internally.** `signInWithPasskey()` /
   `registerPasskey()` perform the `navigator.credentials` call
   themselves and POST the result to GoTrue. As of the beta they do
   **not** expose a "bring-your-own assertion" entry point, so we can't
   hand them an assertion obtained natively. (Re-check this as the API
   leaves beta — a public `verifyPasskey({ assertion })`-style method
   would collapse most of this plan.)

3. **No `webcredentials` association yet.** `public/.well-known/apple-app-site-association`
   currently declares only `applinks`. Native passkeys require a
   `webcredentials` entry for `cardigan.mx` plus the
   `com.apple.developer.associated-domains` entitlement to include
   `webcredentials:cardigan.mx` (today it only has `applinks:cardigan.mx`).

## Options (pick one when we pick this up)

### Option A — Native ASAuthorization plugin + server ceremony (recommended)
Bridge to iOS's native passkey APIs and verify on our own server.

- **Client:** add a Capacitor passkey plugin (e.g. `@capgo/capacitor-native-biometric`-style, or a purpose-built wrapper over
  `ASAuthorizationPlatformPublicKeyCredentialProvider`). It runs the
  registration/assertion against RP ID `cardigan.mx` (allowed because the
  app has `webcredentials:cardigan.mx` associated), and returns the
  attestation/assertion to JS.
- **Server:** a new `api/` endpoint pair (`passkey-register-*`,
  `passkey-auth-*`) that performs the WebAuthn server ceremony with a lib
  like `@simplewebauthn/server`, stores credentials in a new
  `user_passkeys` table (RLS `auth.uid() = user_id`), and on success mints
  a Supabase session via the Admin API (`generateLink` /
  `admin.createSession`-style) returned to the client to
  `setSession()`.
- **Pros:** full control; works regardless of Supabase beta surface;
  one credential store shared with web (same RP ID) so a passkey made on
  web works in the app and vice-versa.
- **Cons:** most code; we own the WebAuthn verification + a session-mint
  path (security-sensitive — must `requireAdmin`-style guard, rate-limit,
  and never expose the service-role key client-side, per CLAUDE.md).

### Option B — Load the app from `https://cardigan.mx` in the webview
Set `server.url` in `capacitor.config.json` so the WebView origin becomes
`https://cardigan.mx`, making web passkeys work unmodified.

- **Pros:** smallest passkey-specific code (reuses the web path entirely).
- **Cons:** large architectural change — kills offline/bundled-asset
  loading, changes the update model, and re-introduces cross-origin
  concerns the local-bundle setup was chosen to avoid. **Not recommended**
  purely to unlock passkeys.

### Option C — Wait for Supabase's native passkey path to mature
`supabase-swift` already has passkey methods; if Supabase ships a
JS/Capacitor-friendly native bridge (or a BYO-assertion verify method),
Option A's server half disappears.

- **Pros:** least long-term maintenance.
- **Cons:** unscheduled; we don't control the timeline (beta as of
  May 2026, GA "expected Q2 2026" per the changelog — verify before
  relying on it).

## Concrete steps for Option A (when greenlit)

1. Apple Developer: add the **Associated Domains** capability's
   `webcredentials:cardigan.mx` to the App ID; add a `webcredentials`
   block to `public/.well-known/apple-app-site-association` (and `dist/`
   copy is generated at build); add `webcredentials:cardigan.mx` to
   `ios-config/App.entitlements`.
2. Add/author a Capacitor passkey plugin; `cap sync` in the CI iOS build.
3. `supabase/migrations/NNN_user_passkeys.sql` — credential table + RLS.
4. `api/passkey-*.js` endpoints (registration options/verify, auth
   options/verify) using `@simplewebauthn/server`, wrapped in
   `withSentry`, rate-limited via the existing Vercel firewall pattern,
   minting a session through `api/_admin.js`.
5. Client: a `nativePasskey.js` lib mirroring `nativeAppleSignIn.js`;
   branch `usePasskeys` + the AuthScreen button to use it when
   `isNative()`. Flip `passkeysSupported()` to allow native once wired.
6. Tests: server ceremony unit tests under `api/__tests__/`; keep the
   pure helpers unit-testable per CLAUDE.md.

## Enablement checklist for the WEB feature (do this to turn it on)

Even the web feature is currently **inert** (flag OFF). To go live:

1. **Supabase dashboard → Authentication → Passkeys:** enable; set
   - RP Display Name: `Cardigan`
   - RP ID: `cardigan.mx`
   - RP Origins: `https://cardigan.mx` (add `http://localhost:5173` for
     local dev only). Note: `*.vercel.app` preview URLs are **not**
     subdomains of `cardigan.mx`, so passkeys won't work on preview
     deploys — that's expected.
2. **Vercel env:** set `VITE_PASSKEYS_UI_ENABLED=true` (Production; and
   Preview if you want the buttons visible there, though the ceremony
   only succeeds on `cardigan.mx`). Redeploy — Vite env changes only take
   effect on the next build.
3. Verify on `https://cardigan.mx` in iPhone Safari: log in → accept the
   post-login nudge → confirm a passkey is created (Settings → Seguridad
   → Llaves de acceso shows it) → sign out → "Continuar con passkey".
4. **Do not** enable Supabase's server-side captcha enforcement (separate
   issue, see CLAUDE.md › Auth captcha) — unrelated, but both touch auth.
