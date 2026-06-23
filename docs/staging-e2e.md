# Staging Supabase + real-auth money-write E2E (WS-0 / WS-5b)

A dedicated **staging** Supabase project backs the real-auth write E2E
(`e2e/money-write.spec.js`) — coverage the hermetic demo smoke can't give,
because demo mode makes every mutation a no-op. The staging project is
isolated from production; the spec signs in as a seeded throwaway user and
exercises the actual write path (FAB → PaymentModal → submit) through real
GoTrue auth, RLS, and the patient-counter trigger.

## Project

- **Org:** Cardigan (`gmawxcuqdkwculayfbaf`)
- **Project:** `cardigan-staging` (ref `nykcmlriuagysaoxfule`, region `us-east-2`), free tier
- **URL:** `https://nykcmlriuagysaoxfule.supabase.co`

### How the schema was built

The live schema is **`supabase/schema.sql` + every file in
`supabase/migrations/`**, applied in order. `schema.sql` alone is *not*
sufficient — it has drifted: ~16 tables (`user_consents`,
`user_subscriptions`, …) and several functions/triggers
(`payments_normalize_date`, `sessions_bump_version`, `bump_version_on_update`,
`update_session_status_atomic`, …) exist **only** in migrations. After both
were applied, staging matched production: **45/45 tables, 25/25 functions,
14/15 triggers** (the one gap, `tr_check_filters`, is admin-analytics only).
To rebuild from scratch, apply `schema.sql` then the migrations via the
Supabase Management API (`POST /v1/projects/{ref}/database/query`),
tolerating `already exists` as idempotent.

> Drift note: `schema.sql` is missing the `bump_version_on_update()`
> function definition (the `groups_bump_version` trigger references it but it
> lives in migration 065). Worth reconciling `schema.sql` in a future pass.

## Seeding

`scripts/seed-e2e-staging.mjs` ensures the test user and clears every
first-login gate so the spec lands straight on a writable Home:

- `user_profiles.profession` + `signup_source(+_at)` → skips both onboarding steps
- `user_consents` @ `POLICY_VERSION` → skips the consent banner
- fresh trial (writes allowed), no encryption keys (no unlock gate)

It also seeds patient **"Paciente E2E"**: one completed session @ $1,000,
$0 paid → **amountDue $1,000**. The spec records a $1,000 payment (→ al
corriente) and resets between runs.

```bash
npm run e2e:staging:seed      # node --env-file=.env.staging.local scripts/seed-e2e-staging.mjs
npm run e2e:staging:verify    # data-layer proof: create → balance-move → delete → revert (no browser)
npm run test:e2e:staging      # the Playwright UI spec (needs a browser with internet)
```

## Local env (gitignored)

- `.env.e2e-staging` — Vite build env: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (public).
- `.env.staging.local` — `STAGING_SERVICE_ROLE` + the test user creds (secret; `*.local`).

Both are regenerated from the Supabase Management API; nothing secret is committed.

## CI

`.github/workflows/ci.yml` → job **`e2e-staging`**. A guard step no-ops the
whole job when the secrets are absent (forks / outside PRs); the spec also
self-skips on missing creds. Required repository **Actions secrets**:

| Secret | Value |
|---|---|
| `STAGING_SUPABASE_URL` | `https://nykcmlriuagysaoxfule.supabase.co` |
| `STAGING_SUPABASE_ANON_KEY` | staging anon key (Supabase → Project Settings → API) |
| `STAGING_SERVICE_ROLE` | staging service-role key (same page; secret) |
| `STAGING_TEST_USER_EMAIL` | `e2e-writer@cardigan.mx` |
| `STAGING_TEST_USER_PASSWORD` | the seeded test password |

> The container this was built in can't reach external HTTPS from a headless
> browser (proxy-gated egress + MITM CA the bundled Chromium doesn't trust),
> so the UI spec is validated by CI (open internet), while the data-layer
> verifier proves the staging money path locally.
