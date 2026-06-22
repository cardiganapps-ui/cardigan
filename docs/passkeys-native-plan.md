# Passkeys (WebAuthn) — web + native iOS

> Status: **implemented (web + native iOS), pending on-device verification
> for the native half.** The web flow is fully functional. The native iOS
> flow is wired end-to-end in code/config but can only be confirmed on a
> real iOS 17.4+ device via TestFlight (passkeys don't work in the
> Simulator and can't be built/run in the Linux CI sandbox).

## Architecture — one passkey, everywhere

Both web and native use **Supabase Auth's** passkey backend (GoTrue),
Relying Party ID **`cardigan.mx`**. A passkey enrolled on the web works in
the native app and vice-versa — there is **no custom server, no custom
credential table, no session-minting**. (An earlier draft of this doc
proposed a custom `@simplewebauthn` server; that was rejected because it
would fragment the credential store from the web passkeys.)

```
        ┌─────────────────────────── Supabase GoTrue ───────────────────────────┐
        │  /auth/v1/passkeys/{registration,authentication}/{options,verify}       │
        │  RP ID: cardigan.mx   •   RP origins: https://cardigan.mx               │
        └───────────────▲───────────────────────────────────▲────────────────────┘
                        │ navigator.credentials                │ navigator.credentials
                        │ (real, browser-native)               │ (shimmed → ASAuthorization)
        ┌───────────────┴───────────────┐      ┌──────────────┴───────────────────┐
        │ WEB  (https://cardigan.mx)     │      │ NATIVE iOS (capacitor://localhost)│
        │ supabase.auth.signInWithPasskey│      │ same call → @capgo shim →         │
        │ runs the ceremony directly     │      │ iOS ASAuthorization (Face/Touch ID)│
        └────────────────────────────────┘      └───────────────────────────────────┘
```

The insight that makes native simple: Supabase's `signInWithPasskey()` /
`registerPasskey()` drive the ceremony through `navigator.credentials`.
`@capgo/capacitor-passkey`'s `autoShimWebAuthn()` **patches
`navigator.credentials.{create,get}`** to forward to native
ASAuthorization, and on iOS 17.4+ encodes the configured origin
(`https://cardigan.mx`) into `clientDataJSON` so GoTrue's verify accepts
it. So the **same Supabase calls + the same UI** work on native with zero
auth-flow forking.

## What's implemented

### Shared / web
- `supabaseClient.ts` — `auth.experimental.passkey: true`; supabase-js ≥ 2.105.
- `src/config/passkeys.ts` — `VITE_PASSKEYS_UI_ENABLED` flag +
  `passkeysSupported()` (web: any browser with `PublicKeyCredential`;
  native: **iOS only**, Android excluded).
- `usePasskeys` hook, `useAuth.signInWithPasskey`, the AuthScreen
  "Continuar con passkey" button, Settings → Seguridad management sheet,
  and the post-login enrollment nudge. All platform-agnostic — they call
  Supabase, which calls `navigator.credentials`.

### Native iOS
- **Dependency:** `@capgo/capacitor-passkey` (v8, matches Capacitor 8).
- **Shim bootstrap:** `src/lib/nativePasskeyShim.ts::initNativePasskeys()`
  calls `autoShimWebAuthn({ origin: "https://cardigan.mx" })` at launch
  (iOS only), invoked from `src/main.tsx`.
- **Capacitor config:** `plugins.CapacitorPasskey` in
  `capacitor.config.json` (`origin` + `domains`).
- **Associated domains:** `webcredentials:cardigan.mx` added to
  `ios-config/App.entitlements` (copied over the generated project by
  `scripts/apply-ios-config.sh`) and a `webcredentials` block added to
  `public/.well-known/apple-app-site-association`.

### Supabase + Vercel (already configured this session)
- Supabase auth config: `passkey_enabled=true`, `webauthn_rp_id=cardigan.mx`,
  `webauthn_rp_origins=https://cardigan.mx`, display name `Cardigan`
  (set via the Management API).
- Vercel env `VITE_PASSKEYS_UI_ENABLED=true` on Production + Preview
  (effective on the next deploy).

## On-device verification checklist (the part that needs a Mac + iPhone)

The native flow compiles and is wired correctly to the best of static
analysis, but **passkeys can only be confirmed on a real iOS 17.4+
device** (Face ID/Touch ID + iCloud Keychain; the Simulator can't do the
associated-domain passkey dance reliably). After the next TestFlight
build:

1. **AASA propagation.** Confirm `https://cardigan.mx/.well-known/apple-app-site-association`
   serves the `webcredentials` block with `Content-Type: application/json`
   and no redirect. Apple's CDN caches it; allow a few minutes after deploy.
2. **Entitlement survived the build.** In the archived app, confirm
   `com.apple.developer.associated-domains` includes
   `webcredentials:cardigan.mx` (apply-ios-config.sh copies our template;
   the plugin's cap-sync hook also writes it — either is fine, just
   confirm it's present, not clobbered).
3. **Enroll on native.** Log in (password/Apple) → accept the post-login
   "Crear passkey" nudge → confirm the system passkey sheet appears and a
   passkey is saved to iCloud Keychain. Verify it shows under
   Settings → Seguridad → Llaves de acceso.
4. **Sign in on native.** Sign out → tap "Continuar con passkey" → Face ID
   → confirm you land authenticated.
5. **Cross-device parity.** A passkey enrolled on `cardigan.mx` in Safari
   should also work in the native app (same RP ID) and vice-versa.
6. **iOS < 17.4 fallback.** On an older device the origin encoding may not
   match `https://cardigan.mx` and verify will fail — confirm it fails
   *gracefully* (toast, no crash) and password/Apple still work. If we need
   to support < 17.4, gate the button to `iOS ≥ 17.4` (needs a native
   version probe; deferred).

## Known limitations / decisions
- **Android passkeys are intentionally off.** Android's
  `clientDataJSON.origin` is the app-signature (`android:apk-key-hash:…`),
  which Supabase's strict origin check rejects. Supporting it would mean
  adding the Android origin to `webauthn_rp_origins` (if/when Supabase
  accepts that format) + Digital Asset Links. Out of scope.
- **WebAuthn-as-MFA (second factor) is not enabled** — Supabase returned
  "Enabling of MFA with WebAuthn not currently supported". We use passkeys
  as a primary passwordless method only; TOTP remains the 2FA path.
- **Beta API.** Supabase passkeys are beta (GA expected Q2 2026). The
  experimental flag + the `/passkeys/*` endpoint shapes may change; re-check
  on supabase-js upgrades.

## How to switch it OFF fast
Set `VITE_PASSKEYS_UI_ENABLED=false` in Vercel and redeploy — all passkey
UI disappears on web and native, existing passkeys stay valid in Supabase.
For a server-side kill, set `passkey_enabled=false` via the Management API.
