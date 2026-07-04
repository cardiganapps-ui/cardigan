# Cardigan — App Store Submission Kit

Practical, copy-paste-ready material for submitting the iOS app for public
App Store review. Derived from the actual codebase (privacy policy,
auth/subscription gating, analytics, encryption). Keep this in sync when
those change.

## 0. Store metadata (es-MX) — paste into App Store Connect → "App Information" + the version page

- **Privacy Policy URL:** `https://cardigan.mx/privacidad/`  ← public static page (no login)
- **Support URL:** `https://cardigan.mx`
- **Marketing URL:** `https://cardigan.mx`
- **Primary language:** Spanish (Mexico)
- **Primary category:** Business · **Secondary:** Productivity *(avoid "Medical" — it triggers stricter review and this is a record-keeping tool, not a medical device)*
- **Price:** Free *(the Pro subscription is sold off-App-Store on the web; iOS shows no purchase UI per the reader-app model — see §1)*

**App name (≤30):**
```
Cardigan: Agenda y pacientes
```
**Subtitle (≤30):**
```
Para psicólogos y terapeutas
```

> **ASO rationale (Jul 2026).** Searching "Cardigan" surfaces ~30 car games
> before us (Apple's fuzzy matching maps *cardigan* → *car*, and those games
> have millions of installs vs. our 2 ratings — verified via the iTunes
> Search API: we ranked #31 in MX). The app name is the heaviest-weighted
> search field, so it must carry category tokens, not just the brand.
> Subtitle carries the audience tokens. Rules that shaped these strings:
> - Never repeat a word across name / subtitle / keywords — each word is
>   indexed once; duplication wastes characters.
> - Include Spanish plurals explicitly ("terapeutas" in the subtitle,
>   "terapeuta" in keywords): the query *"app para terapeutas"* did NOT
>   match us while only singular "terapeuta" sat in the keyword field —
>   Apple's Spanish stemming can't be trusted.
> - Name changes go through App Review, so they only land with a version
>   submission — batch this with the next release.
**Promotional text (≤170, editable without review):**
```
Lleva tu consulta en una sola app: agenda, expedientes, pagos y notas, con recordatorios automáticos y cifrado opcional. 30 días gratis, sin tarjeta.
```
**Keywords (≤100, comma-separated):**
```
psicologo,psicologa,terapeuta,terapia,nutriologo,citas,consultorio,expediente,honorarios,clinica
```
*(96 chars. "agenda"/"pacientes" moved to the app name, "psicólogos"/
"terapeutas" to the subtitle — don't re-add them here. "psicologa" is
deliberate: most MX therapists are women and search the female form.)*
**Description (≤4000):**
```
Cardigan es la app de gestión para profesionales independientes que atienden personas: psicólogos, nutriólogos, profesores particulares, maestros de música y entrenadores. Reúne tu agenda, tus pacientes, tus pagos y tus notas en un solo lugar, diseñado para ser rápido y bonito.

QUÉ PUEDES HACER
• Agenda — vista de día, semana y mes. Sesiones recurrentes, cancelaciones y reagendados en segundos.
• Pacientes y expedientes — contacto, tarifa por sesión, historial y documentos, organizados por persona.
• Pagos y finanzas — registra cobros, ve cuánto te deben y cuánto llevas en el mes. Saldos pendientes siempre a la vista.
• Notas profesionales — clínicas, de progreso o de sesión, con cifrado opcional en reposo para máxima privacidad.
• Recordatorios — recibe avisos de tus próximas sesiones por notificación.
• Sincroniza tu calendario — suscribe tus sesiones a Apple Calendar, Google Calendar o iCloud.
• Documentos — adjunta PDFs e imágenes (recibos, estudios) por paciente.

HECHO PARA TU PRÁCTICA
Cardigan se adapta a tu profesión: el vocabulario y los campos cambian según seas psicólogo, nutriólogo, tutor, maestro de música o entrenador.

PRIVACIDAD
Tus datos están aislados por cuenta. Las notas pueden cifrarse con una contraseña que nunca sale de tu dispositivo. Cumplimos con la LFPDPPP. Aviso: https://cardigan.mx/privacidad/

PRUEBA GRATIS
Empieza con 30 días gratis, sin tarjeta. Después, Cardigan Pro está disponible por suscripción (se gestiona desde cardigan.mx).

¿Dudas? Escríbenos a privacy@cardigan.mx.
```
**What's New (this version):**
```
• Rediseñamos la pantalla de inicio en iPad: más limpia, espaciada y elegante.
• Barra de navegación con acabado "liquid glass" y transiciones más suaves.
• Sincronización de calendario corregida y mejor inicio de sesión con Apple.
• Decenas de detalles pulidos en modo claro y oscuro.
```

**Screenshots:** generated at the exact required sizes — iPhone 6.9" (1290×2796) and iPad 12.9" (2048×2732), 4 each (Inicio / Agenda / Pacientes / Finanzas). See "screenshots" delivery.

**Age rating:** answer the questionnaire all **None** → **4+**. Note: the app opens specific external links (Stripe portal, calendar feed) in an in-app browser — that is NOT "Unrestricted Web Access", so keep that answer **No** (stays 4+).

> Status of the big blockers (already handled in code — do not "fix"):
> - **In-App Purchase (3.1.1 / 3.1.3a):** Stripe is gated OFF iOS. `ProUpgradeSheet`
>   shows no pricing, no subscribe button, no external link on native iOS
>   (reader-app pattern). ✅
> - **Sign in with Apple (4.8):** implemented for native iOS (`useAuth.ts`). ✅
> - **Account deletion (5.1.1 v):** Ajustes → Zona peligrosa → Eliminar mi cuenta. ✅
> - **Permission usage strings:** camera + photo library set in Info.plist. ✅
> - **Admin** is web-only on native; **encryption export flag** is set. ✅

---

## 1. App Review Information (paste into App Store Connect → "Notes")

```
Cardigan is a practice-management tool for independent health & education
professionals (psychologists, nutritionists, tutors, music teachers, personal
trainers) to manage their own patients/clients, sessions, payments, notes and
documents. All UI text is Spanish (es-MX).

HOW TO REVIEW WITHOUT AN ACCOUNT
On the login screen, tap "Ver demo" to enter a fully-populated read-only demo
with sample data — no sign-up required. This is the fastest way to see every
screen (Inicio, Agenda, Pacientes, Finanzas, notes, documents).

TEST ACCOUNT (full read/write)
  Email:    <REVIEWER TEST EMAIL — create a dedicated reviewer account>
  Password: <REVIEWER TEST PASSWORD>
This account is on an active trial/comp so all features are available.

SIGN IN WITH APPLE
Sign in with Apple is supported on the login screen and completes natively.

SUBSCRIPTION MODEL (why there is no in-app purchase)
Cardigan is a multiplatform business service. The optional "Cardigan Pro"
subscription is sold and managed only on our website (cardigan.mx) and via
other platforms — it is NOT offered, priced, or linked inside the iOS app, in
line with App Store Review Guideline 3.1.3(a). The iOS app shows an
informational line only; there is no purchase UI to review. Existing
subscribers simply sign in and their account already has access.

PUSH NOTIFICATIONS
Used only for optional session reminders, requested with context (after the
user opts in), never required to use the app.

CONTACT
privacy@cardigan.mx
```

> ⚠️ Replace the test-account placeholders before submitting — Apple rejects
> submissions where the provided credentials don't work. Even though demo mode
> exists, supply a real account too (some reviewers won't find the demo button).

---

## 2. Privacy "Nutrition Labels" (App Store Connect → App Privacy)

Cardigan **does collect** data and most of it **is linked to the user's
identity**. **Nothing is "Used to Track You"** — there is no advertising SDK,
no IDFA, no data brokers, and analytics is first-party (Vercel) with a PII
denylist. Answer Apple's "Used to track you?" = **No** for every type.

| Apple data type | Collected? | Linked to user? | Used for tracking? | Source in app |
|---|---|---|---|---|
| **Contact Info — Name** | Yes | Yes | No | Account holder name; patient/client/tutor names entered by the user |
| **Contact Info — Email** | Yes | Yes | No | Account email; payer email via Stripe checkout |
| **Contact Info — Phone** | Yes | Yes | No | Patient/tutor phone numbers entered by the user |
| **Health & Fitness — Health** | Yes | Yes | No | Clinical notes, body measurements, dietary/medical history (psychology/nutrition/training) |
| **Financial Info — Payment Info** | Yes | Yes | No | Card data collected **by Stripe's SDK** (never touches Cardigan servers) |
| **Financial Info — Other** | Yes | Yes | No | Session rates, payment amounts/methods, balances, business expenses |
| **User Content — Photos/Videos** | Yes | Yes | No | Avatar photos, receipt images, uploaded document images |
| **User Content — Other** | Yes | Yes | No | Professional notes, uploaded PDFs/documents, patient records |
| **Identifiers — User ID** | Yes | Yes | No | Account user_id (also stamped on analytics events) |
| **Identifiers — Device ID** | Yes | Yes | No | Web-push subscription token (only if reminders enabled) |
| **Usage Data — Product Interaction** | Yes | Yes | No | Vercel Analytics conversion events (trial/checkout/etc.), PII-scrubbed |
| **Diagnostics — Crash Data** | Yes | No* | No | Sentry — PII fields scrubbed before leaving the device |
| **Diagnostics — Performance Data** | Yes | No* | No | Sentry |

\* Sentry events are scrubbed of PII via a denylist; mark "Not Linked" unless
you intentionally attach user identity in Sentry (verify current Sentry config).

**Not collected:** precise location, biometrics, browsing history, contacts,
search history, sensitive demographic data, advertising data.

> Third-party processors (for your records / privacy review, not the labels):
> Supabase (DB/auth), Cloudflare R2 (documents), Vercel (hosting + analytics),
> Resend (transactional email), Sentry (diagnostics), Stripe (payments),
> Anthropic (the optional "Cardi" assistant + receipt OCR — Pro only),
> Apple/Google (push delivery). All enumerated in `src/data/privacy.ts` §6.

---

## 3. Export Compliance (encryption)

`scripts/apply-ios-config.sh` sets `ITSAppUsesNonExemptEncryption = false`, so
each build skips the export-docs upload. Assessment of whether that's correct:

- **Transport:** HTTPS/TLS only — exempt.
- **At rest (opt-in note encryption):** implemented with **standard WebCrypto
  algorithms only** — AES-256-GCM, PBKDF2-SHA256, RSA-OAEP-2048
  (`src/lib/cryptoNotes.ts`). No proprietary crypto.

Because the app's encryption is limited to **standard algorithms used to
protect user data**, the `= NO` answer is the commonly-accepted classification
and is defensible. Caveat: apps that *implement* encryption (even standard) can
still fall under U.S. self-classification (ECCN 5D992) and may owe an annual
self-classification report to BIS and a French encryption declaration. This is
a legal/compliance question, not an Apple-review blocker — flag it to counsel,
but keep `= NO` for the App Store answer.

---

## 4. Remaining App-Store-Connect tasks (not code — you, with my help)

- [ ] **Privacy policy URL** — must be public + reachable. Confirm
      `https://cardigan.mx` exposes the policy at a stable URL for the metadata field.
- [ ] **App Privacy** answers — transcribe the table in §2.
- [ ] **Reviewer notes + working test account** — §1 (replace placeholders).
- [ ] **Screenshots** (required sizes), description, keywords, support URL,
      marketing URL, **age rating** questionnaire.
- [ ] **Category** — Medical or Business (Business is the safer fit; it's a
      practice-management tool, not a medical device — avoids stricter Medical review).
- [ ] **Device family decision** — currently ships universal (iPhone+iPad). Either
      confirm the responsive layout holds on iPad or set iPhone-only (see "iPad
      readiness" task) to avoid iPad-UI rejections.
- [ ] **Legal review** — LFPDPPP counsel pass (esp. nutrition/trainer health data
      per the TODO in `privacy.ts`) before public marketing.

---

## 5. Things still worth doing in code before submit (optional polish)

- Accessibility pass (VoiceOver/aria-labels on icon buttons).
- Native bug sweep (Apple-sign-in end-to-end, offline/error states, push prompt
  timing) — in progress.
- Offline/airplane-mode behavior (reviewers test this).
