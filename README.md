# Cardigan

Mobile-first PWA (+ native iOS/Android via Capacitor) that helps solo health and
education practitioners — psychologists, nutritionists, tutors, music teachers, and
trainers — manage patients, recurring sessions, payments, notes, and documents.
All UI is in Spanish; currency is MXN. Live at **https://cardigan.mx**.

## Why it exists

Solo practitioners run their practice out of spreadsheets and chat threads. The number
that matters most — *who owes me money* — is the easiest to get wrong. Cardigan's core
is a defensively-engineered billing engine: every balance is re-derived from raw session
and payment rows through a single canonical formula, reconciled by database triggers, and
audited nightly against the source of truth. Trust in that number is the product.

## Tech stack

- **Frontend:** React 19 + Vite 5, custom CSS design tokens (no UI library), plain JS/JSX.
- **Backend:** Supabase (PostgreSQL + Auth + row-level security).
- **Storage:** Cloudflare R2 (S3 API) for documents and note attachments.
- **Serverless:** Vercel functions under `api/` (admin ops, presigned URLs, web-push,
  Stripe billing, webhooks).
- **PWA:** `vite-plugin-pwa` (`injectManifest`) with a custom service worker.
- **Native:** Capacitor shells for iOS (TestFlight via GitHub Actions) and Android.
- **Billing:** Stripe (Cardigan Pro subscription + optional patient payments via Connect).
- **Observability:** Sentry (web + serverless), `/api/health`.

## Getting started

```bash
npm install
npm run dev        # local dev server
```

Create `.env.local` from `.env.example`. The `bugs` script and any `api/` function need
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus R2 and VAPID keys
for document/push work.

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run preview      # preview the production build
npm run lint         # ESLint
npm run test         # unit tests (vitest)
npm run test:e2e     # Playwright smoke tests
npm run audit:api    # verify every API route checks auth before using the service role
npm run audit:signup # end-to-end signup/sign-in health probe
```

## Architecture at a glance

- `src/hooks/useCardiganData.js` coordinates all network fetches and composes the domain
  action hooks (`usePatients`, `useSessions`, `usePayments`, `useNotes`, `useDocuments`,
  `useExpenses`, `useGroups`). State is provided through `CardiganContext`.
- `src/utils/accounting.js` is the canonical money math — pure, unit-tested, and the
  single home of the `amountDue` formula.
- `api/*.js` are Vercel routes; `api/_*.js` are shared helpers (never exposed as routes).
  Every mutating route verifies the caller's JWT before touching the service-role client.
- `supabase/schema.sql` is the canonical schema; forward changes live in
  `supabase/migrations/`.

Contributor and operational guidance — including the financial-integrity invariants that
must never regress — lives in [`CLAUDE.md`](./CLAUDE.md).
