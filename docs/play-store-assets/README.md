# Play Store listing assets

Source-of-truth copies of the Google Play store-listing graphics for
`mx.cardigan.app`. These are version-controlled so the listing can be
re-uploaded or regenerated consistently.

| File | Play field | Spec | Notes |
| --- | --- | --- | --- |
| `icon-512.png` | App icon | 512×512 PNG | Derived from `assets/icon.png` (1024²) |
| `feature-graphic.jpg` | Feature graphic | 1024×500 JPEG | Brand teal + icon + tagline, no alpha |
| `screenshots/01-inicio.png` | Phone screenshot | 1236×2400 PNG | Inicio (home) |
| `screenshots/02-agenda.png` | Phone screenshot | 1236×2400 PNG | Agenda |
| `screenshots/03-pacientes.png` | Phone screenshot | 1236×2400 PNG | Pacientes |
| `screenshots/04-finanzas.png` | Phone screenshot | 1236×2400 PNG | Finanzas |

Screenshot aspect ratio is 1.94:1 (under Play's 2:1 cap). They were
captured from the real app running in demo mode (`/?testMode=1` →
"Probar demo"), with the `.app-banner--demo` strip hidden for clean
frames.

## How they were produced
- **Screenshots:** Playwright (Chromium) against a local `vite preview`
  of the `--mode e2e` build, viewport 412×800 @ deviceScaleFactor 3.
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
