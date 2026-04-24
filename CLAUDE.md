# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# ⚠️ PRIME DIRECTIVE — FINANCIAL DATA INTEGRITY

**Maintaining the integrity of users' financial data is the #1 priority of this codebase.** Cardigan's viability as a business rests on therapists trusting the numbers they see. Any change that touches sessions, payments, patient counters, or accounting derivations must be reasoned through carefully and tested before landing.

Concrete rules — all enforced above every other consideration:

1. **Never duplicate sessions.** Any code path that inserts into `sessions` must be idempotent against existing rows for the same `(patient_id, date, time)`. The DB has a partial unique index enforcing this (`uniq_sessions_patient_date_time` in `supabase/schema.sql`); keep it in sync with any schema changes and handle the `23505` unique-violation error path cleanly (skip / merge, never crash).
2. **Never silently mark sessions completed.** The "auto-complete past scheduled → completed" behavior is **display-only**. It MUST NOT influence `amountDue`, `patient.billed`, or any other persisted accounting number. If you iterate sessions for money math, iterate `upcomingSessions` (raw DB state), not `enrichedSessions`.
3. **The canonical amountDue formula is fixed and must not drift.**
   ```
   amountDue = Σ(rate) over sessions where status ∈ {completed, charged}  −  paymentsReceived
   ```
   - `rate` is per-session (`session.rate`, falling back to `patient.rate`) — preserves historical accuracy across rate changes.
   - `paymentsReceived` is the sum of every payment row for that patient (or the `patient.paid` counter, which must stay in sync with that sum).
   - **No** `SCHEDULED` sessions count. **No** auto-completed past sessions count. **No** `CANCELLED` (without-charge) sessions count.
   - If you add a new session status to `SESSION_STATUS`, explicitly decide whether it contributes and document it in the formula block above.
4. **Denormalized counters (`patient.billed`, `patient.paid`, `patient.sessions`) and their fallback recalc (`utils/patients.js::recalcPatientCounters`) must use the same formula as the live amountDue calc.** A mismatch silently inflates or deflates balances on the next recalc.
5. **Every mutation that touches money has a revert path.** Optimistic updates to counters must capture the prior value and restore it on server error, or call `recalcPatientCounters` to rebuild from truth. Never leave a half-applied update.
6. **Money math belongs in pure, unit-tested helpers.** Tests live in `src/utils/__tests__/`. Any new accounting branch gets a test before shipping.
7. **When in doubt, audit.** `scripts/audit-accounting.mjs` (run with `node --env-file=.env.local scripts/audit-accounting.mjs`) walks every patient, re-derives their balance from raw rows, and flags drift vs. the denormalized counters plus any duplicate sessions. Run it after any change in this area and before declaring an accounting bug "fixed."

If you are about to touch anything in `useCardiganData`, `usePatients`, `useSessions`, `usePayments`, `utils/patients.js`, `utils/recurrence.js`, `supabase/schema.sql`, or the `sessions` / `payments` / `patients` tables — re-read this section first.

---

# Cardigan

Mobile-first PWA for therapists to manage patients, sessions, payments, notes, and documents. All UI text is Spanish. No TypeScript — plain JS/JSX.

## Tech Stack
- **Frontend:** React 19 + Vite 5, custom CSS with design tokens (no UI library)
- **Backend:** Supabase (PostgreSQL + Auth + RLS) for data; Cloudflare R2 (via AWS S3 SDK) for document storage
- **Serverless:** Vercel functions under `api/` for admin ops, R2 presigned URLs, and web-push reminders
- **PWA:** `vite-plugin-pwa` with `injectManifest` strategy, custom `src/sw.js`
- **Hosting:** Vercel, auto-deploys from `main`. Live at **https://cardigan.mx** (canonical custom domain — Cloudflare DNS → Vercel). The `.vercel.app` URLs (`cardigan-app.vercel.app`, legacy `cardigan-fawn.vercel.app`) still work but aren't canonical. Don't point server-to-server calls at `cardigan-fawn` — it 307-redirects and cross-origin redirects strip `Authorization`.
- **Transactional email:** Resend (SMTP) sending from `no-reply@cardigan.mx` via Supabase Auth SMTP. DNS managed in Cloudflare.

## Commands

```bash
npm run dev              # Local dev server
npm run build            # Production build
npm run preview          # Preview production build
npm run lint             # ESLint (ignores dist/ and scripts/)
npm run test             # Run vitest once
npm run test:watch       # Vitest watch mode
npm run test -- dates    # Run a single test file (matches utils/__tests__/dates.test.js)
npm run bugs -- list     # CLI bug report viewer; also: show <id>, delete <id>, clear
```

Tests live in `src/utils/__tests__/` and cover the pure utilities (dates, sessions, contact, files). No component or hook tests exist — don't invent a testing framework for them.

The `bugs` script and any `api/` function require `.env.local` with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus R2 and VAPID keys for document/push work. `.env.local` additionally carries admin tokens for full autonomous control — use them freely; the user has accepted the risk and asked they stay in place:
- `SUPABASE_PAT` — Supabase Management API PAT (DDL, auth config, SMTP settings)
- `VERCEL_TOKEN` — Vercel API token (env vars, deploys, domains)
- `CF_API_TOKEN` — Cloudflare API token with full zone + account access on `cardigan.mx` (DNS, SSL, pages, workers, SSL/TLS)
- `RESEND_API_KEY` — Resend API key (domains, sending, logs)

## Architecture

### Data flow — one hook to rule them all
`src/hooks/useCardiganData.js` is the coordinator. It owns network fetches and composes 5 domain action modules (`usePatients`, `useSessions`, `usePayments`, `useNotes`, `useDocuments`). On load it:
1. Fetches all rows filtered by `user_id` in parallel, mapping `color_idx` → `colorIdx`.
2. Auto-extends recurring sessions: if an active patient's last session is within `RECURRENCE_EXTEND_THRESHOLD_DAYS` (105) of today, appends `RECURRENCE_WINDOW_WEEKS` (15) more weeks. A module-level `_extending` lock prevents concurrent extension from duplicating rows.
3. Returns `enrichedPatients` with computed `amountDue` and `enrichedSessions` with display-only auto-complete.

Mutations go through the domain hooks, which update Supabase and local state optimistically. The result is injected into `CardiganContext` (`src/context/CardiganContext.jsx`) and consumed via `useCardigan()`.

Demo mode (`useDemoData`) returns the same shape with all mutations no-ops, so every screen works unmodified.

### Critical business rules
- **`amountDue = patient.billed − (futureSessionCount × currentRate) − patient.paid`** — preserves historical rate accuracy when rates change.
- **Dates are stored as `"D-MMM"` strings** (Spanish months: `"8-Abr"`) in `sessions.date` and `payments.date`. Parsers accept the legacy space-separated form too, and `useCardiganData::mapRows` normalizes on read so the UI never sees the old format. Convert with `utils/dates.js` (`formatShortDate`, `shortDateToISO`, `isoToShortDate`; `formatShortDateWithYear`/`isoToShortDateWithYear` for the rare case where year context matters, rendered as `"8-Abr-26"`). Date inputs use ISO; display uses short form.
- **Auto-complete is display-only.** Past `scheduled` sessions render as `completed` but are NOT persisted. Users can override any session's status to any other (including reverting to scheduled). See `SESSION_STATUS` in `data/constants.js` — the DB check constraint mirrors this and must stay in sync.
- **Tutor sessions** (for minor patients) are marked by a `"T·"` prefix on `sessions.initials`. Helpers in `utils/sessions.js`. Purple styling is derived from this prefix.
- **Schedule/rate changes** take an effective date, delete future sessions, and regenerate at the new rate.
- **Duplicate patient names are rejected** at creation.

### Database & security
- `supabase/schema.sql` is the canonical schema; forward-looking incremental changes go in numbered files under `supabase/migrations/`. Already-applied catch-up migrations live in `supabase/migrations/archive/` (kept for history, don't re-run). Keep the `sessions.status` and `payments.method` check constraints in sync with `SESSION_STATUS` / `PAYMENT_METHODS` (`data/constants.js`), and keep `ADMIN_EMAIL` in sync with the `is_admin()` function in `schema.sql`.
- Every table has RLS `auth.uid() = user_id`. Admin read-all policies use the `is_admin()` SQL helper (checks JWT email).
- Service-role key is ONLY used in `api/` (Vercel serverless) via `api/_admin.js::getServiceClient()`. Admin endpoints must call `requireAdmin(req, res)` first. Never reference `SUPABASE_SERVICE_ROLE_KEY` from anything under `src/`.

### Serverless API (`api/`)
- `_admin.js`, `_r2.js`, `_push.js` are shared helpers — they must verify the caller's JWT before using the service-role client.
- `upload-url.js` / `document-url.js` / `delete-document.js` issue presigned R2 URLs; `_r2.js::validatePath` enforces `${userId}/…` prefix and blocks traversal.
- `send-session-reminders.js` is the web-push cron (auth'd by `CRON_SECRET`). `push-subscribe.js` / `push-unsubscribe.js` manage `push_subscriptions`. See `supabase/migrations/006_push_notifications.sql` and `007_push_cron.sql`.
- `admin-block-user.js` / `admin-delete-user.js` are admin-only mutations over `auth.users`.

### Service worker & updates
`main.jsx` registers `/sw.js` with `updateViaCache: 'none'`, polls for updates on focus and every 30 min, and dispatches `cardigan-update-ready` events. `components/UpdatePrompt.jsx` surfaces the "Actualización disponible" toast; tapping it posts `SKIP_WAITING` and reloads on `controllerchange`. Do NOT auto-activate waiting SWs — it would reload mid-action.

### Screens & layering
- Routing is hash-based (`useNavigation`). App shell in `App.jsx` renders one screen at a time; overlays (sheets, modals, viewers) stack via `useLayer` which wires Escape/back-button dismissal.
- `screens/expediente/*` splits the patient profile into tab components (Resumen/Sesiones/Finanzas/Archivo) for token efficiency — keep that split when editing.
- `styles/` is also split by domain (`base`, `components`, `screens`, `landing`, `tutorial`, `responsive`, `dark`) with `index.css` as the aggregator. Same reason — keep files narrow.

### Admin & demo modes (read-only UIs)
- Admin: `gear icon → AdminPanel → "Ver como usuario"` loads another user's data. Dark "Modo lectura" banner, FAB hidden, writes blocked.
- Demo: `AuthScreen → "Ver demo"` bypasses login with `useDemoData`. Teal banner, FAB hidden, all mutations no-op.

Both flows rely on a single `readOnly` flag branching — don't split the rendering paths.

## Ops — running things against live infra

The tokens in `.env.local` give you direct access to the live DB and Vercel project. Prefer small one-off `.mjs` scripts at the repo root (so `@supabase/supabase-js` resolves), run with `node --env-file=.env.local <file>`, then delete when done — they shouldn't accumulate under `scripts/`.

### Supabase Management API (for DDL / arbitrary SQL)
`POST https://api.supabase.com/v1/projects/{ref}/database/query` with `Authorization: Bearer $SUPABASE_PAT` and JSON body `{ "query": "<sql>" }`. Extract `{ref}` from `SUPABASE_URL` hostname (`<ref>.supabase.co`). This is the only way to run DDL or any statement that PostgREST won't accept.

Runs as the `postgres` role, which has limits:
- ✅ Arbitrary DML, DDL (`ALTER TABLE`, `CREATE FUNCTION`, etc.), reads from `cron.job` / `cron.job_run_details` / `pg_catalog.*`.
- ❌ `ALTER DATABASE postgres SET ...` — permission denied. Configure things at role or job scope instead.

For regular data operations, `supabase-js` + the service-role key is simpler and still bypasses RLS.

### Vercel API (for env vars, deploys, project settings)
Base: `https://api.vercel.com`, header `Authorization: Bearer $VERCEL_TOKEN`. Project name is `cardigan` (find ID via `GET /v9/projects?search=cardigan`).

Gotchas that cost an hour this session:
- **`type:"encrypted"` env writes work, but reading them back with `?decrypt=true` returns ciphertext** (~1176 chars starting with `eyJ`) because this token lacks the env-decrypt permission. Don't trust read-back to verify a write — verify by redeploying and checking that the running function sees the value. `type:"plain"` reads back as plaintext if you need fast verification.
- **Redeploy = `POST /v13/deployments`** with `target:"production"`, `name:"cardigan"`, and a `gitSource` `{ type:"github", repoId, ref:"main", sha }`. Get `repoId` from any previous deployment's `meta.githubRepoId` (it's a string in the API — cast to Number before sending). `sha` must actually exist on the given `ref`, so re-read `git rev-parse origin/main` right before triggering.
- Env var changes take effect **only on next deploy** — you must redeploy after any `CRON_SECRET`/etc. update or the old value stays injected.

### pg_cron + net.http_post quirks
The only cron job is `send-session-reminders` (every 5 min). The job command is stored as plain text in `cron.job.command` — **secrets are baked into the command text**, not read dynamically from `current_setting()` (that pattern was tried but stored the literal at schedule-time). To rotate the secret: `select cron.alter_job((select jobid from cron.job where jobname='send-session-reminders'), command => $cmd$...$cmd$)`.

- **Call the canonical URL `https://cardigan-app.vercel.app`, not `cardigan-fawn.vercel.app`.** The fawn URL 307-redirects, and cross-origin redirects strip the `Authorization` header per Fetch spec, causing silent 401s. This is also why push reminders hadn't actually been delivering before the fix.
- After any rotation: update the cron command **and** the Vercel `CRON_SECRET` env var **and** redeploy. Bursty diagnostic failures bloat `net.http_request_queue` and you'll see "Out of memory" in `cron.job_run_details` until it drains. Self-heals within a few ticks.
- History lives in `cron.job_run_details` — first stop when debugging cron.

### Email (Resend + Supabase SMTP + Cloudflare DNS)
Transactional auth mail flows: Supabase Auth → SMTP (`smtp.resend.com:465`, user `resend`, pass = `RESEND_API_KEY`) → Resend → user's inbox, sent from `Cardigan <no-reply@cardigan.mx>`. Templates live in `supabase/emails/*.html` and are uploaded to Supabase via the Management API's `/config/auth` endpoint (fields `mailer_templates_*_content` + `mailer_subjects_*`).

- Supabase hides `smtp_pass` behind a hash on read-back — don't verify writes via read; verify by triggering an auth email and watching Resend logs (`GET https://api.resend.com/emails`).
- Supabase's default `rate_limit_email_sent` is 2/hour. Bumped to 100/hour.
- Resend's sandbox sender `onboarding@resend.dev` **only sends to the account owner's email** — useless for real users. A verified custom domain is required.
- Cloudflare holds DNS for `cardigan.mx`. Adding Resend domain = 3 records (TXT DKIM `resend._domainkey`, MX `send`, TXT SPF `send`). Verification takes ~60s on Cloudflare.
- `mailer_autoconfirm: false` — new signups must click "Verificar mi correo" before they can sign in. The `AuthScreen`'s `VerifyPendingPanel` surfaces this (same panel is reused when an unverified user tries to sign in).
- Canonical custom domain CNAMEs (apex + www) point at `cname.vercel-dns.com`, proxied=false so Vercel SSL issuance doesn't bounce off Cloudflare's proxy.

### Vercel serverless routes (`api/`)
Files under `api/*.js` become `/api/*` routes — but **files with names starting with `_` or `__` are NOT exposed as routes** (which is why `_admin.js` / `_push.js` / `_r2.js` work as helpers). Diagnostic endpoints need a plain name like `cron-debug.js` to be reachable.

## Conventions
- **Spanish** for all user-visible text (use `useT()` from `src/i18n`).
- **Currency MXN**, formatted with `.toLocaleString()`.
- **Inline styles** for component-one-offs; reach for `src/styles/*.css` when a class is reused.
- **Conventional commits** (`feat:`, `fix:`, `refactor:`, `style:`, `chore:`).
- **Don't deploy on every commit** — Vercel free tier caps at 100 deploys/day (resets midnight UTC). Batch changes and push when asked.
- When adding or changing a session status / payment method / patient lifecycle value, update `data/constants.js` AND the DB check constraint in `supabase/schema.sql` (plus a migration).
