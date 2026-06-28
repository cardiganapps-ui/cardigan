# Cardigan — Google Play Submission Kit

Practical, copy-paste-ready material for publishing the Android app to
Google Play. The native shell already exists (committed `android/`,
`appId: mx.cardigan.app`, signing wired into `android/app/build.gradle`),
and CI can build + ship a signed AAB once the secrets below are in place —
see `.github/workflows/android-build.yml`. This doc covers the parts that
can't be automated: the Play Console account, the keystore, the service
account, the store listing, and the one-time manual bootstrap.

Store copy (es-MX) is shared with iOS where the fields line up — see
`docs/app-store-submission.md` for the canonical Spanish text; keep both
in sync when the marketing copy changes.

> **Status:** as of this writing the Android app has **never been
> published**. `public/.well-known/assetlinks.json` has an empty
> `sha256_cert_fingerprints` array (it only gets filled after the first
> Play upload enrolls in Play App Signing), and no Play Console listing
> exists yet.

---

## 0. ⚠️ Read first — two blockers that are NOT code bugs

### 0a. The first upload must be done by hand
Google does **not** allow the Play Developer API to create the *very first*
release of a brand-new app. The `Upload to Play` step in
`android-build.yml` will fail (403 / "Only releases with status draft may
be created") until you have uploaded **one** AAB manually through the Play
Console UI and enrolled in Play App Signing. After that single manual
upload, every push to `main` ships automatically. Walkthrough in §4.

### 0b. Stripe CTA is currently shown on Android (Play Billing risk)
On **iOS** the Pro upgrade sheet hides all pricing and the subscribe
button (reader-app pattern, App Store Guideline 3.1.3(a)). The gate is
`isNative() && isIOS()` in `src/components/ProUpgradeSheet.tsx` — which
means on **Android native the full price + "Suscribirme" CTA linking to
web/Stripe checkout is still rendered**, and the same is true of the
upgrade banners in `src/components/app/AppBanners.tsx`.

Google Play's Payments policy generally requires Google Play Billing for
in-app digital subscriptions. Sending users to an external web checkout
can get a build rejected (or the app removed) depending on how Google
currently enforces it in Mexico. **Decide this before submitting:**

- **Option A — mirror iOS (lowest risk):** change the gate from
  `isNative() && isIOS()` to `isNative()` in `ProUpgradeSheet.tsx` and
  `AppBanners.tsx` so Android also shows the inert informational line with
  no price/CTA. Pro stays sold on the web; existing subscribers just sign
  in. This is the safe, ship-it-now choice.
- **Option B — integrate Google Play Billing:** add the Play Billing
  flow for Android purchases. Much larger scope; only worth it if you
  want in-app Android conversions.
- **Option C — rely on external-offer allowances:** post-*Epic v. Google*
  some external-link/alternative-billing paths are permitted. This is a
  legal/policy judgement call — get confirmation before betting a launch
  on it.

This kit assumes **Option A** unless you choose otherwise. It is a
product/legal decision, so the code gate was intentionally left unchanged.

---

## 1. One-time account + tooling setup (manual)

1. **Google Play Developer account** — register at
   <https://play.google.com/console/signup>. One-time **$25 USD** fee,
   plus identity verification (can take 1–2 days for a new individual or
   org account). Use the org identity you want shown as the developer
   name.
2. **Create the app** in Play Console → *Create app*:
   - App name: **Cardigan**
   - Default language: **Spanish (Latin America) – es-419** (or es-MX)
   - App or game: **App**
   - Free or paid: **Free** (the Pro subscription is sold off-Play; see §0b)
   - Declarations: accept developer program policies + US export laws.

---

## 2. Upload keystore (one-time, back it up forever)

The release upload key signs the AAB you send to Play. **If you lose it
you must file a Google key-reset appeal (1–2 day turnaround); if it leaks,
someone else can publish updates as you.** Generate it once and store it
somewhere durable (password manager / encrypted backup), never in git
(`android/.gitignore` already excludes `*.keystore`, `*.jks`, and
`keystore.properties`).

```bash
# from the repo root — wraps keytool with the right dname/validity
bash scripts/android-keystore.sh
#   → android/cardigan-upload.keystore   (RSA-2048, 100-year validity)
#   → android/keystore.properties        (passwords for gradle)
```

Smoke-test a signed build locally before wiring CI:

```bash
npm run cap:bundle:android
#   → android/app/build/outputs/bundle/release/app-release.aab
```

---

## 3. CI secrets (so `android-build.yml` can sign + publish)

Add these at **GitHub → Settings → Secrets and variables → Actions**. The
workflow's first step verifies them all and exits early with a clear
"missing secret X" message if any are absent.

### Signing
| Secret | How to get it |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 android/cardigan-upload.keystore` (on macOS: `base64 -i …`) |
| `ANDROID_KEYSTORE_PASSWORD` | the store password you chose in §2 |
| `ANDROID_KEY_ALIAS` | `cardigan-upload` |
| `ANDROID_KEY_PASSWORD` | the key password you chose in §2 |

### Publishing (Play Developer API)
| Secret | How to get it |
| --- | --- |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | full JSON of a service account — see below |

To mint the service account:
1. Play Console → **Setup → API access** → link (or create) a Google
   Cloud project.
2. In that GCP project, create a **service account**, then create a
   **JSON key** for it and download the JSON.
3. Back in Play Console → API access → **grant access** to that service
   account with at least the **"Release to testing tracks"** permission
   (add "Release to production" later if CI should push to production).
4. Paste the entire JSON file contents into the
   `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` secret.

### Build-time web env (same values as the production web build)
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`,
`VITE_NOTES_RECOVERY_PUBLIC_KEY`, `VITE_SENTRY_DSN`,
`VITE_TURNSTILE_SITE_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`,
`VITE_STRIPE_PRICE_ID`, `VITE_STRIPE_PRICE_ID_ANNUAL`. These mirror the
iOS workflow — reuse the exact same values.

---

## 4. The manual bootstrap upload (one time)

Because of §0a, do the very first upload by hand:

1. Build the AAB locally (`npm run cap:bundle:android`) or grab it from a
   CI run's artifacts.
2. Play Console → your app → **Testing → Internal testing → Create new
   release**.
3. When prompted, **enroll in Play App Signing** (let Google manage the
   app signing key; you keep the upload key from §2). Accept.
4. Upload the AAB, add release notes, roll out to internal testing.
5. Add yourself as an internal tester (Testers tab) and install via the
   opt-in link to confirm the app launches, signs in, and reaches Home.

After this single manual release exists, the CI `Upload to Play` step
starts succeeding on every push to `main`.

### Finish Android App Links (deep-link verification)
Once enrolled in Play App Signing:
1. Play Console → **Setup → App integrity → App signing** → copy the
   **App signing key certificate SHA-256** fingerprint.
2. Paste it into the `sha256_cert_fingerprints` array in
   `public/.well-known/assetlinks.json`, commit, and deploy (Vercel serves
   it at `https://cardigan.mx/.well-known/assetlinks.json`). This flips
   Android App Links auto-verification to ✓ so `cardigan.mx` links open
   the app. (Note the upload-key fingerprint differs from the app-signing
   fingerprint — use the **app signing** one Google shows you here.)

---

## 5. Store listing (Play Console → Grow → Store presence → Main store listing)

Play's fields differ from Apple's. Reuse the Spanish copy from
`docs/app-store-submission.md` and map it as follows.

**App name (≤30):**
```
Cardigan
```

**Short description (≤80):**
```
Agenda, pacientes, pagos y notas para tu consulta, en una sola app.
```

**Full description (≤4000)** — reuse the App Store "Description" block in
`docs/app-store-submission.md` (the `QUÉ PUEDES HACER` / `HECHO PARA TU
PRÁCTICA` / `PRIVACIDAD` / `PRUEBA GRATIS` body). Drop the line that
mentions *Apple Calendar* phrasing if you want it Android-neutral —
"Google Calendar / iCloud / Outlook" already covers it.

### Graphic assets
| Asset | Spec | Source |
| --- | --- | --- |
| App icon | 512×512 PNG (32-bit) | derive from `assets/icon.png` (1024×1024) |
| Feature graphic | 1024×500 PNG/JPG | **needs to be created** — not in repo yet |
| Phone screenshots | 2–8, min 320px, 16:9 or 9:16 | capture from a device/emulator (Inicio / Agenda / Pacientes / Finanzas) |
| 7" + 10" tablet screenshots | optional but recommended | same four screens on a tablet emulator |

> The iOS kit references generated iPhone/iPad screenshots at Apple sizes;
> those don't match Play's requirements, so capture fresh Android frames.
> The feature graphic (1024×500) has no equivalent on iOS — it must be
> designed.

---

## 6. Content & policy declarations (Play Console → Policy)

Play gates publishing on a set of declarations — fill all of these or the
release stays blocked:

- **Privacy policy URL:** `https://cardigan.mx/privacidad/`
- **Data safety form:** mirror the iOS "Privacy Nutrition Labels" answers
  in `docs/app-store-submission.md` §2 — data **is collected** and **is
  linked** to the user; **nothing is used for tracking/ads** (no ad SDK,
  no IDFA-equivalent, first-party analytics with a PII denylist). Declare
  encryption in transit + the optional at-rest note encryption.
- **Content rating questionnaire:** answer honestly → expect a low rating
  (no violence/sexual/gambling content). The app opens external links
  (Stripe portal, calendar feed) in an in-app browser.
- **Target audience & content:** adults / professional tool — **not**
  directed at children (keeps it out of the Families program and its extra
  requirements).
- **Ads:** declare **No ads**.
- **App access:** reviewers need to reach the gated screens. Provide the
  **"Ver demo"** path (read-only demo, no signup) **and** a real test
  account with credentials in the App access section (some reviewers won't
  find the demo button) — same accounts as the iOS review notes.
- **Government apps / financial features / health:** Cardigan is a
  record-keeping tool, **not** a medical device or a financial-services
  product (the "pagos" are the therapist's own bookkeeping, not payment
  processing for end users). Categorize as **Business** / **Productivity**,
  not Medical — same rationale as the iOS category choice.

---

## 7. Release tracks & rollout

`android-build.yml` publishes to the **internal** track by default (the
Play analogue of TestFlight). To promote:

- **Manual dispatch:** Actions → *Android Build & Play* → *Run workflow* →
  pick `track` = `alpha` / `beta` / `production`.
- Or promote a tested internal build to production from the Play Console
  UI (Testing → Internal testing → Promote release).

When you first go to **production**, Play also requires **closed/open
testing with a minimum number of testers over ~14 days** for new personal
developer accounts before production is unlocked — plan the launch
timeline around that if the account is an individual one.

---

## 8. Quick checklist

- [ ] Play Developer account created + verified ($25)
- [ ] App created in Play Console (`mx.cardigan.app`)
- [ ] Decision made on §0b (Stripe CTA on Android) — code adjusted if Option A
- [ ] Upload keystore generated + backed up (§2)
- [ ] All CI secrets added (§3)
- [ ] First AAB uploaded manually + Play App Signing enrolled (§4)
- [ ] `assetlinks.json` fingerprint filled in + deployed (§4)
- [ ] Store listing copy + graphics uploaded (§5)
- [ ] Data safety + content rating + app access declarations done (§6)
- [ ] Internal testing build verified on a real device
- [ ] CI green on push to `main` (auto-ships to internal)
- [ ] Promote to production when ready (§7)
