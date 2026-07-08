# Play Store listing assets

Source-of-truth copies of the Google Play store-listing graphics for
`mx.cardigan.app`. These are version-controlled so the listing can be
re-uploaded or regenerated consistently.

| File | Play field | Spec | Notes |
| --- | --- | --- | --- |
| `icon-512.png` | App icon | 512×512 PNG | Derived from `assets/icon.png` (1024²) |
| `feature-graphic.jpg` | Feature graphic | 1024×500 JPEG | Brand teal + icon + tagline, no alpha |
| `screenshots/01-inicio.png` | Phone screenshot | 1080×2160 PNG | Inicio (home) — annotated |
| `screenshots/02-agenda.png` | Phone screenshot | 1080×2160 PNG | Agenda — annotated |
| `screenshots/03-pacientes.png` | Phone screenshot | 1080×2160 PNG | Pacientes — annotated |
| `screenshots/04-finanzas.png` | Phone screenshot | 1080×2160 PNG | Finanzas — annotated |
| `screenshots/05-notas.png` | Phone screenshot | 1080×2160 PNG | Notas — annotated |
| `screenshots/06-gastos.png` | Phone screenshot | 1080×2160 PNG | Gastos — annotated |

Screenshot aspect ratio is exactly 2:1 (Play's phone cap). Each frame is
an **annotated marketing composition** (June 2026 closed-testing feedback:
"screenshots should showcase features"): a Spanish feature headline +
one-liner over the brand-teal gradient, with the real app capture inside
a rounded device frame. The captures come from the real app running in
demo mode (`/?testMode=1` → "Probar demo"), with the `.app-banner--demo`
strip hidden for clean frames.

## How they were produced
- **Screenshots:** `node scripts/play-store-screenshots.mjs` — Playwright
  (Chromium) drives a local `vite preview` of the `--mode e2e` build at
  viewport 412×800 @ deviceScaleFactor 3, then composes each capture into
  the annotated 1080×2160 frame (flags: `--skip-build`, `--raw-only`,
  `--frame <id>`). Captions live in the script's `FRAMES` array.
- **Feature graphic:** an HTML/CSS card (embedded Nunito + the app icon)
  rendered headless at exactly 1024×500 and saved as JPEG.
- **Icon:** the 1024² `assets/icon.png` rendered at 512×512.

## Listing copy
The es-419 title / short / full description live in
`docs/app-store-submission.md` (§0). They were pushed to Play together
with these images via the Play Developer API (`edits.listings` +
`edits.images`).

## Re-uploading
The listing was set programmatically with the Play service account
(`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`). To refresh it, run an `edits`
session: `edits.insert` → `listings.update` / upload `edits.images`
(imageType `icon` / `featureGraphic` / `phoneScreenshots`) → `commit`.
