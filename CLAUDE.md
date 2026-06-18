# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# ⚠️ PRIME DIRECTIVE — FINANCIAL DATA INTEGRITY

**Maintaining the integrity of users' financial data is the #1 priority of this codebase.** Cardigan's viability as a business rests on therapists trusting the numbers they see. Any change that touches sessions, payments, patient counters, or accounting derivations must be reasoned through carefully and tested before landing.

Concrete rules — all enforced above every other consideration:

1. **Never duplicate sessions.** Any code path that inserts into `sessions` must be idempotent against existing rows for the same `(patient_id, date, time)`. The DB has a partial unique index enforcing this (`uniq_sessions_patient_date_time` in `supabase/schema.sql`); keep it in sync with any schema changes and handle the `23505` unique-violation error path cleanly (skip / merge, never crash).
2. **Accounting uses raw DB rows + a date-aware predicate — never `enrichedSessions`.** The UI's "past scheduled → completed" auto-complete is a display affordance. Accounting must NOT read `enrichedSessions`; instead it iterates `upcomingSessions` (raw) and applies the predicate in `utils/accounting.js::sessionCountsTowardBalance`. Any visual mark in the UI of "completed" MUST come out to the same answer the predicate produces, otherwise users see one number and owe another.
3. **The canonical amountDue formula is fixed and must not drift.**
   ```
   consumed  = Σ(rate) over sessions that have taken place:
                 • status = completed (explicit mark)
                 • status = charged   (cancel-with-charge — owed immediately,
                                       no date gate)
                 • status = scheduled AND (date + time + 1h) ≤ now
                                       (auto-complete equivalent — the slot
                                        has passed; most therapists don't
                                        manually mark completions, so the
                                        business needs this branch)
   amountDue = max(0, consumed − patient.paid)
   credit    = max(0, patient.paid − consumed)
   ```
   - `rate` is per-session (`session.rate`, falling back to `patient.rate`) — preserves historical accuracy across rate changes.
   - `patient.paid` must stay in sync with the sum of every `payments` row for that patient. `recalcPatientCounters` reconciles on optimistic-update failure.
   - **`CANCELLED` (without charge) never counts.** Future `SCHEDULED` never counts. `CHARGED` counts regardless of date.
   - If you add a new session status to `SESSION_STATUS`, explicitly decide whether it contributes and document it in the formula block above, AND update `sessionCountsTowardBalance` + its tests.
4. **Denormalized counters (`patient.billed`, `patient.paid`, `patient.sessions`) are now maintained by DB triggers** (`trg_payments_recalc_paid` from migration 068, `trg_sessions_recalc_counters` from migration 069). Hooks no longer issue follow-up patient counter UPDATEs — the trigger fires atomically with each session/payment write and runs the canonical predicate (`public.session_counts_at` in SQL) using the user's tz from `notification_preferences`. The SQL predicate **MUST stay in sync** with `utils/accounting.js::sessionCountsTowardBalance` — if you change the JS predicate, update the SQL function in a migration AND mirror the change in `supabase/schema.sql`'s trigger block. The audit script reconciles both predicates against the same data nightly; drift fails CI. `recalcPatientCounters` (`utils/patients.js`) stays as a manual recovery tool, no longer plumbed into the hot path.
5. **Every mutation that touches money has a revert path.** Optimistic updates to counters must capture the prior value and restore it on server error, or call `recalcPatientCounters` to rebuild from truth. Never leave a half-applied update.
6. **Money math belongs in pure, unit-tested helpers.** Tests live in `src/utils/__tests__/`. Any new accounting branch gets a test before shipping.
7. **When in doubt, audit.** `scripts/audit-accounting.mjs` (run with `node --env-file=.env.local scripts/audit-accounting.mjs`) walks every patient, re-derives their balance from raw rows, and flags drift vs. the denormalized counters plus any duplicate sessions. Run it after any change in this area and before declaring an accounting bug "fixed." `scripts/audit-phantoms.mjs` is the targeted companion — it finds past `status='scheduled'` rows on slots the patient no longer uses, the signature of phantom recurring sessions left behind by an earlier auto-extend bug.
8. **Auto-extend derives the schedule from FUTURE sessions only.** `computeAutoExtendRows` in `utils/recurrence.js` filters `scheduledRegular` to rows whose `date >= today`. Past `status='scheduled'` rows must NEVER feed the schedMap — they're auto-display "completed" but stay scheduled in the DB (per rule above), and including them regenerates phantom future sessions on slots the user has already moved away from. Tests in `utils/__tests__/recurrence.test.js` lock this in; the regression test deliberately uses `status=SCHEDULED` for past abandoned slots because `status=COMPLETED` (the earlier test variant) silently passed despite the bug shipping. If you need to walk historical rows for any reason, do it OUTSIDE the schedule-derivation path.

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
npm run test:e2e         # Playwright smoke test (auto-builds with --mode e2e, serves on :5180)
npm run bugs -- list     # CLI bug report viewer; also: show <id>, delete <id>, clear
```

Unit tests live in `src/utils/__tests__/` and cover the pure utilities (dates, sessions, contact, files). End-to-end smoke tests live in `e2e/` — a single Playwright spec that opens a note in demo mode, types, deletes, and types again. The spec catches bug classes that lint + vitest can't (TDZ at editor mount, stale-closure on rapid type-after-delete, generic "did the editor render?" smoke). Demo mode + `?testMode=1` unlocks the editor's readOnly gate in `vite --mode e2e` builds only — production demo users never see this branch. When adding more flows, mirror the pattern: tiny scope per test, demo data only, no real auth.

The `bugs` script and any `api/` function require `.env.local` with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus R2 and VAPID keys for document/push work. `.env.local` additionally carries admin tokens for full autonomous control — use them freely; the user has accepted the risk and asked they stay in place:
- `SUPABASE_PAT` — Supabase Management API PAT (DDL, auth config, SMTP settings)
- `VERCEL_TOKEN` — Vercel API token (env vars, deploys, domains)
- `CF_API_TOKEN` — Cloudflare API token with full zone + account access on `cardigan.mx` (DNS, SSL, pages, workers, SSL/TLS)
- `RESEND_API_KEY` — Resend API key (domains, sending, logs)
- `GITHUB_TOKEN` — Fine-grained GitHub PAT scoped to `cardiganapps-ui/cardigan` (Contents/Issues/PRs/Workflows/Administration r+w). Use this when the session-scoped local git proxy 403s on push/delete, or when the GitHub MCP exposed in the session lacks the operation you need (e.g. `delete_branch`). Pattern: `curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/...`. Bulk branch cleanup example: `curl -X DELETE -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/cardiganapps-ui/cardigan/git/refs/heads/<branch>`. Token expires every 90 days — when it stops working, ask for a fresh one rather than silently degrading.

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
- **Expenses (Gastos) — money-out ledger.** Expenses are pure overhead (no `patient_id`). Recurring templates auto-generate one expense per (template, year, month) slot, deduplicated by the partial unique index `uniq_expenses_recurring_period`. Any code path that inserts a recurring-generated row MUST handle 23505 cleanly (skip / no-op, never crash) — same invariant as `uniq_sessions_patient_date_time`. Auto-backfill is **capped at `RECURRING_EXPENSE_AUTO_BACKFILL_MONTHS`** (currently 2) — anything older surfaces as a one-tap "Generar N gastos pendientes" prompt on the Gastos tab. **Silently inserting beyond that cap is a prime-directive violation.** Receipts: deletion of an expense MUST first call `deleteDocument(receipt_document_id)` (in `useExpenses::deleteExpense`) to clean up the document row + R2 object; the DB-side `on delete set null` is a backstop only. Personal-treatment expenses (`tax_treatment='personal'`) are excluded from the P&L view but kept in the ledger so therapists can use one app for everything. The `expenses.category` check constraint mirrors `EXPENSE_CATEGORIES` in `data/constants.js` — keep them in sync.

### Database & security
- `supabase/schema.sql` is the canonical schema; forward-looking incremental changes go in numbered files under `supabase/migrations/`. Already-applied catch-up migrations live in `supabase/migrations/archive/` (kept for history, don't re-run). Keep the `sessions.status` / `payments.method` / `expenses.category` / `expenses.tax_treatment` / `documents.kind` check constraints in sync with `SESSION_STATUS` / `PAYMENT_METHODS` / `EXPENSE_CATEGORIES` / `TAX_TREATMENTS` (`data/constants.js`), and keep `ADMIN_EMAIL` in sync with the `is_admin()` function in `schema.sql`.
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

### Git push reliability — bypass the broken proxy with GITHUB_TOKEN

The local git remote points at a session-scoped proxy (`http://local_proxy@127.0.0.1:<port>/git/cardiganapps-ui/cardigan`). Fetches work; **pushes 403 with "send-pack: unexpected disconnect"** for entire sessions. The proxy is harness infrastructure — we don't control its source or config.

**Permanent fix (run once per fresh clone):** route pushes direct to GitHub with a credential helper that reads `GITHUB_TOKEN` from `.env.local`. After this, `git push` Just Works regardless of proxy state, and the token never lands in `.git/config`.

```bash
git remote set-url --push origin https://github.com/cardiganapps-ui/cardigan.git
git config credential.https://github.com.helper '!f() { tok=$(awk -F= '"'"'/^(export[[:space:]]+)?GITHUB_TOKEN=/{sub(/^(export[[:space:]]+)?GITHUB_TOKEN=/,""); gsub(/^"|"$/,""); print; exit}'"'"' /home/user/cardigan/.env.local); echo "username=x-access-token"; echo "password=$tok"; }; f'
```

Fetch URL stays on the proxy (works fine); push URL goes direct. Token rotation = update `.env.local` only; no git config change needed.

**If the credential helper isn't set up yet** and you need to push *right now*: `git push https://x-access-token:$GITHUB_TOKEN@github.com/cardiganapps-ui/cardigan.git main` (export the var first with `set -a; . .env.local; set +a`).

**MCP fallback** (`mcp__github__create_or_update_file`, `mcp__github__push_files`) still works for small writes but has a ~30K-token-per-file ceiling because the file content goes through the context window. Prefer the credential-helper path — it has no size limit, attributes commits to the right author, and doesn't burn context.

**Don't:** chain `sleep`s waiting for the proxy to recover — it's session-broken state, not a transient. **Don't:** retry the proxy more than ~3 times before switching to the direct URL.

### Supabase Management API (for DDL / arbitrary SQL)
`POST https://api.supabase.com/v1/projects/{ref}/database/query` with `Authorization: Bearer $SUPABASE_PAT` and JSON body `{ "query": "<sql>" }`. Extract `{ref}` from `SUPABASE_URL` hostname (`<ref>.supabase.co`). This is the only way to run DDL or any statement that PostgREST won't accept.

Runs as the `postgres` role, which has limits:
- ✅ Arbitrary DML, DDL (`ALTER TABLE`, `CREATE FUNCTION`, etc.), reads from `cron.job` / `cron.job_run_details` / `pg_catalog.*`.
- ❌ `ALTER DATABASE postgres SET ...` — permission denied. Configure things at role or job scope instead.

For regular data operations, `supabase-js` + the service-role key is simpler and still bypasses RLS.

### Schema drift detection (CI guard)
The live `public` schema is mirrored to `supabase/schema.snapshot.json` — a canonical JSON inventory of every table, column, constraint, index, trigger, function, and RLS policy. `.github/workflows/schema-drift.yml` regenerates that inventory and diffs it on every push / PR that touches `supabase/`, plus nightly at 04:15 UTC. CI fails when production DDL has been changed out-of-band (ad-hoc SQL in the dashboard) or when a migration / `schema.sql` edit was committed without being applied — drift in either direction is a real-world bug class.

When you intentionally change schema (new migration, function rewrite, RLS edit): apply the change to live, then regenerate + commit the snapshot.
```
node --env-file=.env.local scripts/schema-snapshot.mjs --update
git add supabase/schema.snapshot.json
```
The script reads via the same `SUPABASE_PAT` the audit workflow uses; it never writes to the database. The diff path also runs as part of `--update`, so a stale snapshot is the only way to push and immediately fail CI.

### Vercel API (for env vars, deploys, project settings)
Base: `https://api.vercel.com`, header `Authorization: Bearer $VERCEL_TOKEN`. Project name is `cardigan` (find ID via `GET /v9/projects?search=cardigan`).

Gotchas that cost an hour this session:
- **`type:"encrypted"` env writes work, but reading them back with `?decrypt=true` returns ciphertext** (~1176 chars starting with `eyJ`) because this token lacks the env-decrypt permission. Don't trust read-back to verify a write — verify by redeploying and checking that the running function sees the value. `type:"plain"` reads back as plaintext if you need fast verification.
- **Redeploy = `POST /v13/deployments`** with `target:"production"`, `name:"cardigan"`, and a `gitSource` `{ type:"github", repoId, ref:"main", sha }`. Get `repoId` from any previous deployment's `meta.githubRepoId` (it's a string in the API — cast to Number before sending). `sha` must actually exist on the given `ref`, so re-read `git rev-parse origin/main` right before triggering.
- Env var changes take effect **only on next deploy** — you must redeploy after any `CRON_SECRET`/etc. update or the old value stays injected.

### Cron — Vercel Cron Jobs
The only scheduled job is `send-session-reminders` (every 5 min, `*/5 * * * *`). It's declared in `vercel.json`'s `crons` array. Vercel sends a `GET` to `/api/send-session-reminders` with `Authorization: Bearer ${CRON_SECRET}`; the endpoint validates via `verifyCronSecret()` in `api/_push.js`. The endpoint is idempotent — `sent_reminders` deduplicates by `(session_id, user_id)` so re-firing within the same window is safe.

To rotate `CRON_SECRET`: update the Vercel env var in both Production + Preview, then trigger a redeploy (env changes only take effect on next build). No DB-side change needed — the secret lives only in Vercel env now.

To debug a missed reminder: check the function's runtime logs in the Vercel dashboard (filter by `/api/send-session-reminders`) and inspect `sent_reminders` in Supabase to see whether dedupe blocked a re-send.

> Historical note: this used to run from Supabase `pg_cron` calling out via `net.http_post`. We migrated off that in Apr 2026 because pg_cron baked secrets into the job command, bloated `net.http_request_queue` on bursty failures, and stripped `Authorization` on the legacy `cardigan-fawn.vercel.app` cross-origin redirect. The pg_cron job has been `cron.unschedule()`d.

### Email (Resend + Supabase SMTP + Cloudflare DNS)
Transactional auth mail flows: Supabase Auth → SMTP (`smtp.resend.com:465`, user `resend`, pass = `RESEND_API_KEY`) → Resend → user's inbox, sent from `Cardigan <no-reply@cardigan.mx>`. Templates live in `supabase/emails/*.html` and are uploaded to Supabase via the Management API's `/config/auth` endpoint (fields `mailer_templates_*_content` + `mailer_subjects_*`).

- Supabase hides `smtp_pass` behind a hash on read-back — don't verify writes via read; verify by triggering an auth email and watching Resend logs (`GET https://api.resend.com/emails`).
- Supabase's default `rate_limit_email_sent` is 2/hour. Bumped to 100/hour.
- Resend's sandbox sender `onboarding@resend.dev` **only sends to the account owner's email** — useless for real users. A verified custom domain is required.
- Cloudflare holds DNS for `cardigan.mx`. Adding Resend domain = 3 records (TXT DKIM `resend._domainkey`, MX `send`, TXT SPF `send`). Verification takes ~60s on Cloudflare.
- `mailer_autoconfirm: false` — new signups must click "Verificar mi correo" before they can sign in. The `AuthScreen`'s `VerifyPendingPanel` surfaces this (same panel is reused when an unverified user tries to sign in).
- Canonical custom domain CNAMEs (apex + www) point at `cname.vercel-dns.com`, proxied=false so Vercel SSL issuance doesn't bounce off Cloudflare's proxy.

### Auth emails go through Resend SMTP — the Resend key IS the Supabase `smtp_pass`
With `mailer_autoconfirm: false`, **every sign-up first sends a confirmation email**, so if Supabase Auth can't reach Resend the entire signup fails with `500 unexpected_failure / "Error sending confirmation email"` — the user sees a generic error and no account is created. This is the App Review 2.1(a) rejection of build 86 (June 2026, iPad: "the app produced an error when we attempted to register a new account"). It is **not platform-specific** — it fails for every new user, which is why a reviewer reliably hits it.

The trap: the Supabase Auth `smtp_pass` is a **Resend API key**, and Supabase hashes it on read-back so you can't see drift. Rotating/deleting the Resend key in the Resend dashboard **silently breaks all auth email** (signup confirmation, password reset, magic link) until `smtp_pass` is re-set to the new key. That's exactly what happened here — Supabase held a deleted key.

```
# re-point Supabase Auth SMTP at the current Resend key (live immediately, no redeploy)
curl -X PATCH "https://api.supabase.com/v1/projects/{ref}/config/auth" \
  -H "Authorization: Bearer $SUPABASE_PAT" -H "Content-Type: application/json" \
  -d "{\"smtp_pass\": \"$RESEND_API_KEY\"}"
# verify by REPRODUCING a signup (smtp_pass can't be read back) — a 500 here is the bug:
curl -s -w '\n%{http_code}\n' -X POST "https://{ref}.supabase.co/auth/v1/signup" \
  -H "apikey: <anon-key>" -H "Content-Type: application/json" \
  -d '{"email":"you+test@gmail.com","password":"TestPassw0rd!2026"}'
```
**Whenever you rotate the Resend key, update `smtp_pass` in the same step** and re-run the signup probe. Confirm Resend itself can send first (`POST https://api.resend.com/emails`) to isolate a bad key from a bad Supabase config.

Two traps when PATCHing `config/auth` SMTP:
- **Always send the FULL smtp block** (`smtp_host`/`smtp_port`/`smtp_user`/`smtp_pass`/`smtp_admin_email`/`smtp_sender_name`) **plus `rate_limit_email_sent`** in one PATCH. A partial `smtp_pass`-only PATCH silently resets `rate_limit_email_sent` back to the default **2/hour** (and can blank the rest of the smtp group on reconcile) — at 2/hour the 3rd signup in an hour 500s again, which is the same review-blocking bug wearing a different hat. Keep it pinned at 100.
- **Management API config reads are eventually consistent.** A GET immediately after a PATCH can return stale/null fields for ~10–20s even though the write landed. Don't conclude a wipe from one fast read — wait and re-GET, and verify by REPRODUCING a signup (behavior is ground truth; the read is not).

### Auth captcha (Cloudflare Turnstile) — enforcement MUST stay off
The web AuthScreen mounts a Cloudflare Turnstile widget (`src/components/TurnstileWidget.jsx`, gated on `VITE_TURNSTILE_SITE_KEY`) and passes a token to every Supabase auth call. **Supabase's server-side `security_captcha_enabled` MUST remain `false`** (it currently is). The widget cannot run inside the Capacitor native webview (`capacitor://localhost` is not an allowed Turnstile origin and the token never resolves), so `TURNSTILE_ENABLED = !!SITE_KEY && !isNative()` deliberately disables it on native. If server enforcement is ever turned ON, the native shell sends no token and **every native sign-up / sign-in would be rejected with a 400** — the user just sees a red error. Web bot-protection is carried by the Vercel firewall `/api/*` rate limit instead. This is config (not in version control), so it can drift on via a dashboard toggle or project restore. **Before ever turning enforcement on, native needs a captcha-free auth path first** (e.g. a service-role signup endpoint under `api/`).

### Passkeys (WebAuthn) — web + native iOS, Supabase beta
Passkeys are an **additional passwordless login** on top of email/password, Apple, and magic link. Built on **Supabase Auth's passkey beta** (RP ID `cardigan.mx`) — one credential store shared by web and native iOS, **no custom server**. Full design + on-device test checklist in `docs/passkeys-native-plan.md`.
- **Client opt-in:** `src/supabaseClient.js` sets `auth.experimental.passkey: true` (needs supabase-js ≥ 2.105). The UI is double-gated in `src/config/passkeys.js`: the build flag **`VITE_PASSKEYS_UI_ENABLED`** (set true on Vercel Prod+Preview) AND `passkeysSupported()` (web: any `PublicKeyCredential` browser; native: **iOS only** — Android's clientDataJSON origin is the app signature, which Supabase rejects).
- **Pieces:** `usePasskeys` (list/register/remove), `useAuth.signInWithPasskey`, the AuthScreen "Continuar con passkey" button, Settings → Seguridad management sheet, and a once-per-user post-login enroll nudge (`PasskeyEnrollPrompt`, localStorage key `cardigan.passkeyPrompt.done.<uid>`).
- **Native bridge:** `@capgo/capacitor-passkey`'s `autoShimWebAuthn({ origin: "https://cardigan.mx" })` patches `navigator.credentials` → iOS ASAuthorization, so the SAME Supabase calls work in the WebView. Booted from `src/main.jsx` via `src/lib/nativePasskeyShim.js` (iOS only). Requires iOS **17.4+** (browser-style clientDataJSON origin encoding) + `webcredentials:cardigan.mx` in both `ios-config/App.entitlements` and `public/.well-known/apple-app-site-association`, plus `plugins.CapacitorPasskey` in `capacitor.config.json`.
- **Supabase config** (Management API `config/auth`): `passkey_enabled=true`, `webauthn_rp_id=cardigan.mx`, `webauthn_rp_origins=https://cardigan.mx` (a **string**, not array), `webauthn_rp_display_name=Cardigan`. WebAuthn-**as-MFA** (`mfa_web_authn_*`) is NOT supported yet — don't enable it. **Changing `webauthn_rp_id` invalidates every existing passkey** — don't.
- **Kill switch:** `VITE_PASSKEYS_UI_ENABLED=false` + redeploy hides all passkey UI instantly; `passkey_enabled=false` kills it server-side. Existing passkeys stay valid.

### Social sign-in (Apple + Google)
Apple and Google are **additional** login options wired through `useAuth.signInWithProvider(provider)` and rendered by `AuthForm` (both the Entrar and Crear cuenta tabs). `App.jsx` must pass `onProvider={signInWithProvider}` to `AuthScreen` or no provider buttons render (this was missing originally).
- **Apple** — `external_apple_enabled=true`. iOS native uses `@capawesome/capacitor-apple-sign-in` → `signInWithIdToken` (`src/lib/nativeAppleSignIn.js`, nonce hashed per Apple's scheme); web/Android use the OAuth redirect. Always on.
- **Google** — `external_google_enabled=true`, gated in the UI behind **`VITE_GOOGLE_OAUTH_ENABLED`** (Vercel Prod+Preview). Web uses `signInWithOAuth` (code exchange). iOS native uses `@capgo/capacitor-social-login`'s Google picker → `signInWithIdToken` (`src/lib/nativeGoogleSignIn.js`). The native ID token's `aud` is the **iOS** OAuth client ID, so Supabase's `external_google_client_id` holds BOTH the web and iOS client IDs (comma-joined) as valid audiences. Native runs **no nonce** + `external_google_skip_nonce_check=true` (propagating a nonce through the native SDK is fragile; the iOS client ID is bundle-bound so replay risk is low; web is unaffected — it uses code exchange). The reversed iOS client-ID **URL scheme** is injected into `Info.plist` `CFBundleURLTypes` by `scripts/apply-ios-config.sh` (must survive CI regen). Google Cloud project `17610829726`; OAuth clients are Web (Supabase provider + audience) + iOS (native). Client IDs are public; only the **web client secret** is secret (lives in Supabase config, never in the repo). Android native Google is NOT wired (would need its own client + the OAuth redirect won't round-trip) — Android isn't shipped.

### Vercel serverless routes (`api/`)
Files under `api/*.js` become `/api/*` routes — but **files with names starting with `_` or `__` are NOT exposed as routes** (which is why `_admin.js` / `_push.js` / `_r2.js` / `_sentry.js` work as helpers). Diagnostic endpoints need a plain name like `cron-debug.js` to be reachable.

### WhatsApp patient reminders (Meta Cloud API direct)
- Outbound-only (v1). Sends a session reminder to the patient ~`reminder_minutes` before each session, alongside (and reusing the time-window logic of) the existing therapist push.
- **Opt-in is per-patient.** `patients.whatsapp_enabled` + `patients.whatsapp_consent_at`. Toggle in NewPatientSheet (creation) and Patients.jsx (edit) — disabled until a phone is set. The consent timestamp is the LFPDPPP audit record.
- **Recipient is `patients.phone`** in every case. For a minor patient the phone is already the tutor's (per product direction); we don't keep a separate parent-phone column. Greeting variable is `parent` if present, otherwise `name`. Stored as digits-only via `phoneDigits()`; normalized to E.164 at send time via `api/_whatsapp.js::toE164MX()` (prepends `+52` for 10-digit MX numbers).
- **Single approved template:** `cardigan_session_reminder` (UTILITY, `es_MX`). Body: "Hola {{1}}, te recordamos tu sesión {{2}} hoy a las {{3}}. — {{4}}" (recipient name, modality, time `HH:MM`, therapist name). Submit + approval is via Meta Business → WhatsApp → Message Templates; ~24 h. **Sends fail with `error.code` from Meta until the template is approved** — audit row records the failure, no `sent_reminders` row is written, and the next cron tick retries.
- **Cron:** the WhatsApp branch lives inside `api/send-session-reminders.js` after the push branch. It reads the same per-user reminder window, fetches `whatsapp_audit`-eligible patients (`whatsapp_enabled=true && phone`), dedupes via `sent_reminders` rows with `channel='whatsapp'` (the unique key changed to `(session_id, user_id, channel)` in migration 019), and fans out via `Promise.allSettled` so one Meta hiccup doesn't stall the loop.
- **Audit + events:** every send attempt writes a `whatsapp_audit` row (`pending → sent → delivered/read | failed`). Webhook callbacks (Meta → `/api/whatsapp-webhook`) write to `whatsapp_events` and update the matching audit row by `meta_message_id`. `whatsapp_events` is admin-only readable (`is_admin()` policy); `whatsapp_audit` is readable by the owning user via `auth.uid() = user_id`.
- **Webhook:** `api/whatsapp-webhook.js`. GET handles Meta's subscribe handshake (echoes `hub.challenge` when `hub.verify_token` matches `WHATSAPP_WEBHOOK_VERIFY_TOKEN`). POST verifies HMAC-SHA256 over the raw body using `WHATSAPP_APP_SECRET` against the `X-Hub-Signature-256` header (mirror of `api/resend-webhook.js`). Disable Vercel's body parser via `export const config = { api: { bodyParser: false } }`.
- **Env vars (Vercel Production + Preview):** `WHATSAPP_ACCESS_TOKEN` (system-user permanent), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`. Updates take effect on next deploy; redeploy after rotating any of them.
- **Kill switch:** `whatsapp_paused` Edge Config flag. When true, the WhatsApp branch no-ops; push still fires. Use during a Meta outage or while debugging.
- **Privacy:** `src/data/privacy.js` enumerates Meta Platforms Ireland as a transferee and lists the fields shared per send. Bumped `POLICY_VERSION` so existing users re-accept via `ConsentBanner`.
- **UI is gated** behind `VITE_WHATSAPP_UI_ENABLED` (build-time Vite env var). Default = unset → patient toggles in `NewPatientSheet` and `Patients.jsx` are not rendered. The DB columns, server endpoints, and cron branch are all live but inert because no patient can opt in via UI. Flip `VITE_WHATSAPP_UI_ENABLED=true` in Vercel Production + Preview and redeploy when the Meta template + env vars are ready.
- **Privacy** copy: while gated, `src/data/privacy.js` does NOT mention Meta or WhatsApp — adding the paragraph back will require bumping `POLICY_VERSION` to force re-acceptance, so do that in the same commit that flips the UI gate on.
- **Out of scope (v1):** inbound replies (CONFIRMAR / CANCELAR), per-session override, multiple templates, therapist-side WhatsApp (push remains), backoff after N failures.

### Calendar sync (iCalendar feed)
- Each user can opt in to a personal `.ics` feed served at `https://cardigan.mx/api/calendar/<token>`. The token is the only credential — calendar clients can't carry a JWT, so we use the standard "secret URL" pattern (Google Calendar, iCloud, Outlook all do this).
- **Token lifecycle:** managed at `/api/calendar-token` (GET = read, POST = create or rotate, DELETE = revoke). Settings → "Calendario" surfaces the buttons. There's exactly one active token per user (unique constraint on `user_calendar_tokens.user_id`); rotation is an in-place upsert that breaks all existing subscriptions.
- **Privacy:** the feed body uses the full patient name in `SUMMARY` (per product direction — therapists need to read their own calendar at a glance). The token URL is the only credential, so anyone who has it — including the third-party calendar service the user pastes it into — can read patient names. Surface that trade-off in the Settings copy whenever the URL is visible.
- **Generator:** `api/_calendar.js::generateICS()` is the pure helper; tests in `api/__tests__/calendar.test.js` lock down RFC 5545 envelope shape, line folding, escape rules, DTSTART/DTEND TZID anchoring, and that `SUMMARY` includes the full patient name (with initials as a fallback when the name is missing).
- **Timezone:** read from `notification_preferences.timezone`, default `America/Mexico_City`. The embedded `VTIMEZONE` block uses a constant `-0600` offset (Mexico abolished DST in 2022) and is mostly a fallback — major calendar clients prefer their own zoneinfo for known TZIDs.

### Note encryption (opt-in, at rest)
- **Threat model:** a Supabase DB compromise alone should NOT yield therapy-note plaintext. Crypto code lives in `src/lib/cryptoNotes.js`; tests in `src/utils/__tests__/cryptoNotes.test.js`.
- **Master key** (32 bytes, AES-256) is generated client-side and never leaves the browser in plaintext. Two wraps are stored on the server in `user_encryption_keys` (migration 017):
  - `passphrase_wrap` — AES-GCM under a PBKDF2-SHA256(passphrase, salt, 600 000 iters) key. The user's daily unlock path.
  - `recovery_wrap` — RSA-OAEP-2048 under the public key bundled in the client bundle (`VITE_NOTES_RECOVERY_PUBLIC_KEY`). The matching private key (`NOTES_RECOVERY_PRIVATE_KEY`) lives only in the server env and is read solely by `api/admin-recover-encryption.js`.
- **A Supabase-only breach** therefore yields ciphertext + wraps, neither of which is decryptable without the user's passphrase OR the server-held private key. Two-vector compromise is required.
- **Per-note format** (base64 in `notes.content`): `1-byte version || 12-byte IV || GCM ciphertext+tag`. The `notes.encrypted` column flags which lane the read path takes.
- **Recovery KID** rotation: bump `recovery_kid` in the user_encryption_keys row, write a one-shot script that decrypts each row's `recovery_wrap` with the OLD private key and re-wraps with the NEW public key. Both env vars must be available during the migration.
- **Lock semantics:** the master key lives in a `useRef` inside `useNoteCrypto`. Closing the tab clears it. Locking via Settings triggers a `lock()` that overwrites the bytes with zeros before nulling the ref. Existing decrypted notes stay in React state until next refresh — there is no instantaneous wipe; document this trade-off if a user asks.
- **Disable** (Settings → Cifrado → Desactivar) drops the `user_encryption_keys` row. Encrypted notes stay encrypted in the DB and become permanently unreadable. The confirmation requires typing `DESCIFRAR`. Migrating ciphertext back to plaintext on disable is a v2 nice-to-have; ship a script if a user requests it.
- **Setup script for new envs:** `node scripts/generate-notes-recovery-keypair.mjs` once per environment to mint the RSA keypair. Public key goes in Vercel + `.env.local`; private key goes in Vercel only.

### Privacy & LFPDPPP compliance
- **Policy version** lives in `src/data/privacy.js::POLICY_VERSION`. When the policy body changes materially, bump the version string; users whose latest accepted version no longer matches are re-prompted on next login via `components/ConsentBanner.jsx`.
- **Consent storage** is both local (`localStorage['cardigan.consent.v']`) for UX and server-side (`public.user_consents`) for audit. The consent banner writes both.
- **ARCO flows** (Acceso, Rectificación, Cancelación, Oposición) are wired through three endpoints:
  - `POST /api/record-consent` — stamps a `user_consents` row.
  - `GET /api/export-user-data` — returns a JSON attachment with all user-owned data and 1-hour presigned document URLs. Rate-limited to 1/hour via `export_audit`.
  - `POST /api/delete-my-account` — cascade-deletes the user (via `api/_admin.js::deleteUserCascade`, shared with `admin-delete-user.js` so both flows can't drift). Requires `confirmation: "ELIMINAR"` in the body.
- **ARCO contact** is `privacy@cardigan.mx`. Update both the policy body and any external-facing copy if this changes.
- **Legal review before marketing**: the policy text shipped is a first draft. Get a Mexican data-privacy lawyer to review before claiming LFPDPPP compliance externally.

### Stripe SaaS subscriptions (Cardigan Pro)
The therapist-facing billing layer — entirely separate from patient `payments` / `sessions` (those are the therapist's own bookkeeping; this is the therapist paying us).

- **Plan:** "Cardigan Pro" — $149 MXN / month, tax-inclusive, no Stripe-side trial. `STRIPE_PRICE_ID` env points at the right price (test in Preview/Dev, live in Production).
- **Trial gate:** every new account gets a 30-day in-app trial starting at `auth.users.created_at`. After day 30 the user drops to `accessState: "expired"` (read-only — same `readOnly` flag the admin "view as user" mode uses, composed in `App.jsx`). The data is never deleted; subscribing reinstates writes immediately. Admins (`isAdmin(user)` via `ADMIN_EMAIL`) bypass the gate entirely.
- **Tables (migration `030_stripe_subscriptions.sql`):**
  - `user_subscriptions` — one row per user. Created lazily at first checkout (or first referral-code visit). Fields: `stripe_customer_id` (unique), `stripe_subscription_id`, `status`, `current_period_end`, `cancel_at_period_end`, `comp_granted` (admin-granted always-free), `referral_code` (this user's code), `referred_by` (code they came in with), `referral_rewards_count`, `pending_credit_amount_cents`. RLS: user can SELECT their own row; only the service-role (webhook) can write.
  - `stripe_webhook_events` — idempotency log keyed on `event_id`. Webhook inserts on receipt and skips processing on `23505` (duplicate). Admin-readable.
- **Endpoints (`api/`):**
  - `POST /api/stripe-checkout` — JWT-gated. Mints (or reuses) a Stripe customer, accepts an optional `referral_code`, drains any `pending_credit_amount_cents` into the customer's Stripe balance, and returns a Checkout Session URL. Refuses to start a paid checkout when `comp_granted=true` or there's already an active sub (409 with `{ action: "comp_granted" | "use_portal" }`).
  - `POST /api/stripe-portal` — JWT-gated. Returns a Stripe Billing Portal URL for self-service plan management. 404 if no `user_subscriptions` row.
  - `POST /api/stripe-webhook` — HMAC-verified via `STRIPE_WEBHOOK_SECRET` (Stripe-Signature header, manual `crypto.timingSafeEqual` like `resend-webhook.js`). Body parser disabled — verification needs the raw bytes. Source of truth for `status` / `current_period_end` / `cancel_at_period_end`. Idempotency-deduped via `stripe_webhook_events`. On the FIRST `invoice.paid` for an invitee, credits the inviter (Stripe customer balance if real customer; `pending_credit_amount_cents` accrual otherwise) and increments their `referral_rewards_count`.
  - `GET /api/referral-code` — JWT-gated. Lazy-mints the user's 8-char A-Z2-9 (skips 0/O/1/I/L) referral code, returns `{ code, rewardsCount, pendingCreditCents }`.
  - `POST /api/admin-grant-comp` — admin-only. Toggles `comp_granted`. Used for the admin's own account, early-access friends, and pilot users. Refuses to start paid checkout when set.
- **Hook + UI:** `src/hooks/useSubscription.js` exposes `accessState` (`loading | trial | active | expired`), `daysLeftInTrial`, and helpers `startCheckout({ referralCode })` / `openPortal()` / `fetchReferralInfo()`. Trial-expired and trial-ending banners live in `App.jsx`; the full panel is `Settings → Suscripción` (`activeSheet === "plan"`).
- **Env vars (Vercel):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` per environment. Production uses live keys, Preview/Development use test keys. Updates take effect on next deploy.
- **Stripe-side resources to keep aligned:** Product, Price, Webhook endpoint, and Billing Portal configuration exist separately in test mode and live mode. When changing plan price, update **both** test and live prices and rotate `STRIPE_PRICE_ID` in Vercel.
- **Webhook URL:** `https://cardigan.mx/api/stripe-webhook` (registered in both test and live mode with the same event subset).
- **Out of scope (v1):** annual plans, multiple seats per account, taxes beyond tax-inclusive MXN, automated dunning UX (we surface `latest_invoice` URL but don't drive renewal flows from the app — Stripe's email + portal cover it).

### Observability (Sentry + health check)
- **Client errors** are captured via `src/lib/sentry.js` (init in `main.jsx`) + `src/components/ErrorBoundary.jsx`. Init no-ops when `VITE_SENTRY_DSN` is unset or in dev — no noise in local work. `beforeSend` scrubs fields listed in the `PII_FIELDS` set (`patient`, `note`, `content`, `initials`, `email`, `phone`, etc.) before events leave the browser.
- **Serverless errors** route through `api/_sentry.js::withSentry(handler, { name })`. Every mutating route wraps its default export with this. The wrapper reports unhandled exceptions and any 5xx response; 4xx responses in `EXPECTED_STATUSES` (401/403/404/405/409/413/429) are treated as noise and not reported. Secrets/PII are scrubbed the same way as the client.
- **Health check:** `GET /api/health` returns `{ status, checks: { supabase, r2 } }` — 200 when both are up, 503 otherwise. Unauthenticated, returns no user data. Point UptimeRobot (or equivalent) at `https://cardigan.mx/api/health` on a 5-minute interval.
- **Rotating a noisy error:** silence it in the Sentry UI (create an inbound filter or ignore rule) rather than adding a try/catch that hides a real failure. If you need to suppress at the code level, add an allowlist check inside the specific handler — do NOT globally suppress in `_sentry.js`.
- **Env setup:** `VITE_SENTRY_DSN` (client) and `SENTRY_DSN` (server) must be set in Vercel (Preview + Production) before the first post-merge deploy. Keep them distinct — rotation, routing, and sampling are per-DSN.
- **Live setup (as of May 2026):** org slug `cardigan`, two projects:
  - `cardigan-web` (platform: javascript-react) → `VITE_SENTRY_DSN`
  - `cardigan-api` (platform: node) → `SENTRY_DSN`
  Both DSNs are set on Vercel Production + Preview and mirrored in `.env.local`. `SENTRY_AUTH_TOKEN` in `.env.local` is a user auth token with `org:read project:read/write/admin` — use it to create new projects, rotate DSNs, or query issues via the API (`https://sentry.io/api/0/...`). To rotate a DSN: call `POST /projects/cardigan/<slug>/keys/`, swap the new DSN into Vercel + redeploy, then `DELETE /projects/cardigan/<slug>/keys/<oldId>/`.

### Edge Config (feature flags / kill switches)
Reader: `api/_flags.js::getFlag(name)`. Pulls from the Vercel Edge Config store `cardigan-flags` (id `ecfg_ym2ipouu2lo2ywnspc5wbgdd9bsc`), connection string in the `EDGE_CONFIG` env var. The helper falls back to a documented default if the service is unreachable, so a brief Edge Config outage can never crash a request.

Defined flags (see `_flags.js` for inline docs):
- `cron_paused` — when true, `/api/send-session-reminders` short-circuits to `{ sent: 0, paused: true }`. Use during a push outage or while debugging duplicate sends. Default: false.
- `encryption_setup_enabled` — when false, `POST /api/encryption` returns 503. Pauses new encryption sign-ups; existing users are unaffected. Default: true.
- `signups_paused` — informational only for now (AuthScreen doesn't read it). Reserve for incident-response use; wire when you actually need it.
- `whatsapp_paused` — when true, the WhatsApp branch of `/api/send-session-reminders` no-ops; web push reminders continue. Default: false. Use during a Meta Cloud API outage, after a template-approval issue, or while investigating a runaway send.
- `ocr_paused` — when true, `/api/ocr-receipt` returns 503 and ExpenseSheet falls back to manual entry (receipt itself still attaches). Default: false. Use during an Anthropic outage or runaway-cost incident on receipt processing.

To flip a flag (no redeploy needed):
```
curl -X PATCH "https://api.vercel.com/v1/edge-config/ecfg_ym2ipouu2lo2ywnspc5wbgdd9bsc/items?teamId=team_0rR9OfIKmnJ8xFDrOXUkHcT3" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"items":[{"operation":"upsert","key":"cron_paused","value":true}]}'
```
Or use the Vercel dashboard → Storage → Edge Config → cardigan-flags. Reads propagate globally within seconds.

### Vercel Firewall
Configured via `PUT /v1/security/firewall/config?projectId=...&teamId=...`.
- **Active rule:** rate limit `/api/*` to 120 req/min per IP (`api-rate-limit`). 429 response when tripped.
- **CRS modules** (LFI / RFI / RCE / XSS / SQLi managed rule sets) are dashboard-only — the API accepts the JSON but silently keeps them off. Toggle in Vercel dashboard → Settings → Firewall → Managed Rulesets if you want them on.
- **Always-on (no config):** Pro-tier DDoS mitigation, basic bot detection.

To inspect the live config:
```
curl -s "https://api.vercel.com/v1/security/firewall/config?projectId=prj_b7BGSTkTKwLT1aeKPEiKxAlz9Nmk&teamId=team_0rR9OfIKmnJ8xFDrOXUkHcT3" \
  -H "Authorization: Bearer $VERCEL_TOKEN" | jq '.active.rules, .active.crs'
```

### Vercel Pro deployment & preview settings
Set on the project (`prj_b7BGSTkTKwLT1aeKPEiKxAlz9Nmk`):
- **Function region:** pinned to `iad1` (US-East) in `vercel.json` → `regions`. Lowest latency for Mexico without paying for multi-region. Don't change without re-measuring against MX traffic.
- **Skew Protection:** `skewProtectionMaxAge: 43200` (12h). Old API surface stays alive 12h after a new deploy so a stale-tab mutation doesn't blow up. Client opts in via `src/lib/skewProtection.js` stamping `x-deployment-id` on every same-origin `/api/*` fetch.
- **Preview access (`ssoProtection: { deploymentType: "preview" }`):** preview deployments require Vercel team-member login. Production (`cardigan.mx`) remains public. Useful when sharing a preview of the privacy notice with a lawyer for review — give them a Vercel team invite (read-only) instead of a shared password.
- **Password-based preview protection:** NOT enabled. Vercel returns "Advanced Deployment Protection is not enabled on your team" — that's a paid add-on on top of Pro. Vercel Authentication (above) covers the same use case for free.
- **Vercel Toolbar / PR comments:** `gitComments.onPullRequest: true` (default-on for Pro). The floating toolbar appears for logged-in team members on preview deployments — no extra config.
- **Image Optimization:** intentionally not used. Cardigan is Vite + React (not Next.js), avatars stream from R2 directly, and there's no Next `<Image>` equivalent without restructuring the asset pipeline. Re-evaluate if/when avatar bandwidth becomes a real cost.

### Log Drains (deferred — destination required)
Vercel Pro retains function logs for 1 day. To export them in real time, create a log drain pointing at Better Stack (free tier), Logtail, Datadog, or Axiom. Recommended provider: **Better Stack** — generous free tier, JSON-friendly, sub-minute search.

When ready, sign up at the destination, get an HTTP source URL + token, and:
```
curl -X POST "https://api.vercel.com/v1/log-drains?teamId=team_0rR9OfIKmnJ8xFDrOXUkHcT3" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"cardigan-prod","url":"<destination-url>","deliveryFormat":"json","sources":["lambda","static","external","build"],"environments":["production"],"projectIds":["prj_b7BGSTkTKwLT1aeKPEiKxAlz9Nmk"]}'
```
Until then, runtime logs are visible only in the Vercel dashboard's Functions tab and live for 24h.

### iOS → TestFlight builds (Capacitor + GitHub Actions)
The native iOS app is built and shipped to TestFlight by `.github/workflows/ios-build.yml` (macOS runner: `npm run build` → `cap add ios` + `cap sync` → archive → export IPA → `xcrun altool --upload-app`). The `ios/` dir is generated fresh each run, never committed.

**Triggers:** push to `main` touching app code (the workflow ignores `**.md`, `android/**`, `scripts/**` except `apply-ios-config.sh`, and `.github/**` except itself), or a manual `workflow_dispatch` on `ios-build.yml`. The build number is `github.run_number` (monotonic — Apple requires each upload's `CURRENT_PROJECT_VERSION` to strictly increase).

**⚠️ Apple's daily upload limit is the real constraint — BATCH your pushes to `main`.** App Store Connect caps TestFlight uploads per app per rolling ~24h. When exhausted, the build still **compiles, archives, and exports the IPA successfully** — only the final upload step fails with:
```
ERROR: Upload limit reached. ... Please wait 1 day and try again. (90382)
```
Because a build fires on **every** push to `main` that touches app code, a string of small commits in one day (e.g. iterating on a UI fix) silently burns the quota, and the *next* genuinely-important build can't reach testers until the window resets (~24h from the uploads). So: **only push to `main` when you actually want a TestFlight build.** Stack the work on a branch, verify via the web app first (`main` auto-deploys to https://cardigan.mx on Vercel, so every change is testable in iPhone Safari immediately — no upload cap there), and push to `main` once when it's build-worthy.

**Diagnosing a "failed" run:** distinguish a *code* failure (build/archive/export step red → real bug, fix it) from an *upload throttle* (90382 at the `Upload to TestFlight` step → not our code; wait for the limit to reset, then re-trigger by pushing to `main` or re-dispatching the workflow). Check via `mcp__github__get_job_logs` with `failed_only:true`. Note the session-scoped GitHub MCP integration **cannot dispatch or cancel workflow runs** (403 "Resource not accessible by integration") — use a valid `GITHUB_TOKEN` from `.env.local` against the REST API instead, and rotate the token if it 401s.

## Conventions
- **Spanish** for all user-visible text (use `useT()` from `src/i18n`).
- **Currency MXN**, formatted with `.toLocaleString()`.
- **Inline styles** for component-one-offs; reach for `src/styles/*.css` when a class is reused.
- **Page-level background is `var(--white)`, NOT `var(--cream)`.** The body, `.shell`, and the landing surface all sit on white — that's the canonical Cardigan look as of late 2025. `--cream` is now an *accent* token used for inline information bands inside white cards (e.g. `NewSessionSheet` rate row, `ConvertPotentialSheet` banner), alternate-state button backgrounds, and `SessionSheet` modality chips. **Do not use `--cream` as the outer wrapper background of a new screen, sheet, or full-viewport surface** — that's the legacy AuthScreen / ProfessionOnboarding aesthetic and reads as a regression on top of the modernized therapist app. New patient-facing or full-screen flows should mirror `.shell`'s white background and rely on `border: 1px solid var(--border-lt)` + subtle shadow on cards for visual hierarchy. If you find yourself reaching for `background: "var(--cream)"` on a wrapper, stop and reconsider — the answer is almost always `var(--white)`.

### Design system (read before building any new screen)

The therapist app sets the bar for every other surface (patient portal, marketing, claim screens). When something looks "off" it's usually because a new screen invented values instead of following these patterns. Use the tokens, use the existing classes, follow the rules below.

- **Typography.** `--font-d` (Nunito) is the *display* face — used for screen titles, card headers, sheet titles, KPI numbers, button labels. `--font` (Nunito Sans) is body text. Sizes come from the `--text-*` scale (`--text-xs` 11 / `--text-sm` 12 / `--text-md` 14 default body / `--text-lg` 16 / `--text-xl` 20 / `--text-2xl` 24). Eyebrow labels are uppercase, `--text-eyebrow` (10px, never scaled), `letter-spacing: 0.06–0.07em`, weight 700, color `--charcoal-md` or `--charcoal-xl`. Display headlines weight 800 with `letter-spacing: -0.2px to -0.3px`. Don't ship inline px sizes outside the scale unless there's a documented reason.
- **Color semantics — pick by meaning, not aesthetics.** Teal = primary / interactive / active state (FAB, primary buttons, active tabs, links). `--teal-pale` = active row / focus ring backing. `--teal-dark` = labels on teal-pale, primary text accents. `--charcoal` body, `--charcoal-md` secondary, `--charcoal-lt` tertiary, `--charcoal-xl` muted/meta + eyebrows. Status colors are reserved: red = destructive / unpaid / errors, green = success / paid, amber = pending / warnings / charged-status, purple = tutor sessions, blue = virtual modality, rose = interview/potential lane. Use the `--*-bg` companion (`--green-bg`, `--red-bg`, etc.) for tinted panels behind status copy — don't hand-pick rgba alphas.
- **Spacing rhythm.** Card inner padding 14–16px; sheet body padding 20px h / 20–24px v; row vertical padding 12–14px with 16px horizontal; section gaps in vertical stacks 12px (tight) / 14px (form rows) / 16px (default) / 20–24px (between sections). Hit targets ≥ 44×44px (icons inside 20–22px). Inputs in `.input-group` already stack with `margin-bottom: 14px` — don't fight that.
- **Borders, radii, elevation.** `--radius-sm` (8) inputs / small chips; `--radius` (12) bands / rate rows / inline panels; `--radius-lg` (16) cards + sheet panels; `--radius-pill` (100) buttons + chips + segmented controls. `--border-lt` for normal dividers, `--border` for emphasized borders. Elevation: `--shadow-sm` for resting cards, `--shadow` for lifted, `--shadow-lg` reserved for sheets / overlays / expediente. **Buttons are pill-shaped, full stop** — there are no rectangular buttons in this app.
- **Buttons.** Use the `.btn` class family: `.btn-primary` (teal fill / white text — primary CTA), `.btn-secondary` (cream fill / charcoal text), `.btn-ghost` (transparent / charcoal — tertiary), `.btn-danger` (red — destructive). Disabled state is `opacity: 0.55 + cursor: not-allowed`, no hover scale. Active state scales to `0.95` with `--ease-spring`. Don't roll a custom rounded-rect button — extend the class. **Inline-styled tappables (icon buttons, link-pills, image-cards-as-buttons) get `.btn-tap`** — that single class wires `--ease-spring` + `scale(0.94)` press feedback. Without it, the surface feels inert vs. the spring on real `.btn` elements.
- **Sheets are the canonical modal.** Compose: `<div className="sheet-overlay">` + `<div className="sheet-panel">` + `<div className="sheet-handle">` + `<div className="sheet-header">` (sheet-title + sheet-close). Wire `useEscape(safeClose)` + `useFocusTrap(open)` + `useSheetDrag(safeClose, { isOpen })` and gate `safeClose = submitting ? null : onClose` so escape/drag/overlay-click can't close mid-submit. Body padding `0 20px 24px`. Sticky footer with `border-top: 1px solid var(--border-lt)`. There are no centered lightbox modals — everything modal lives at the bottom of the screen.
- **Inputs.** Always wrap in `.input-group` with `<label className="input-label">` + `<input className="input" />`. Validation hints render directly underneath as `.input-error-msg` (12px, red, reserved min-height) or `.input-help` (12px, charcoal-xl). Date and time inputs use `<input type="date|time" />` — the CSS already left-aligns the iOS default. Keep input font-size ≥ 16px to prevent the iOS zoom-on-focus. **Don't add `interactive-widget` to the viewport meta.** We tried `resizes-content` to keep sticky-bottom buttons above the keyboard; it caused severe input lag because iOS Safari re-flows the layout viewport every time the keyboard's autocomplete bar updates (i.e., on every keystroke). Default `resizes-visual` keeps the layout stable; iOS pins position:fixed elements to the visual viewport, so sticky-bottom sheet buttons remain reachable above the keyboard naturally.
- **Cards & rows.** Reach for `.card` (white / radius-lg / `border-lt` / overflow-hidden) before inventing a wrapper. List rows use `.row-item` (12px gap, 13px v-pad / 16px h-pad, min-height 62, `--teal-mist` active state) — same in `.bal-row` for finance. KPI tiles are `.kpi-card`: tabular-nums, eyebrow over a 20–22px display number.
- **Empty states.** Use the `.empty-state` class (in `components.css`): a centered column with `.empty-state-icon` (44×44 `--cream-dark` circle, 20px icon inheriting `currentColor`), `.empty-state-title` (font-d 800 `--text-lg`), and `.empty-state-body` (13px `--charcoal-md`, max-width 320). Status variants tint the icon with `--red-bg`/`--red` (errors) or `--amber-bg`/`--amber` (warnings). Don't hand-roll inline-styled centered text columns — every "no data / no link / nothing here yet" surface routes through this class.
- **Loading states.** Long-running fetches paint a skeleton that mirrors the eventual layout (cards in the right slots, with `.sk-bar` / `.sk-circle` shimmer rectangles standing in for content). See `App.jsx::LoadingSkeleton` for the therapist Home + Finances variants and `PatientHome.jsx::PatientHomeSkeleton` for the patient hero+balance+therapist-card layout. The shimmer animation is paused under `prefers-reduced-motion` automatically. **Don't ship a bare "Cargando…" string** — first paint should always feel like the destination.
- **Iconography.** Icons inherit `currentColor`. Common sizes: 12 (inline meta), 14 (inline next to text), 16 (small UI), 20 (default `<I />`), 22 (top-bar logo / section), 36 (hero), 48 (splash). Wrap in a 44×44 hit target when standalone. Pair with text via `display: inline-flex; align-items: center; gap: 6–10px`.
- **Motion.** Default ease is `--ease-out`; surfaces that "land" (sheets, FAB, cards entering) use `--ease-spring`; small components use `--ease-spring-soft`; cross-fades use `--ease-in-out`. Durations from `--dur-fast` (150 — taps/focus) / `--dur-base` (250 — surface transitions) / `--dur-slow` (400 — sheet open) / `--dur-slower` (600 — drawer / page slide). Don't write raw `0.25s cubic-bezier(...)` — use the tokens. Fire `haptic.success()` / `haptic.warn()` on confirm-style state changes (already plumbed in `ConfirmDialog`, `Toast`, primary submits). `prefers-reduced-motion: reduce` is enforced globally in `responsive.css` (kills animation/transition durations app-wide) — don't fight it with `!important`.
- **Safe areas.** Top inset comes from `--sat` (or `env(safe-area-inset-top, 0px)` directly), bottom from `--sab`. Sticky top bars use `padding-top: calc(var(--sat) + 14px)`. Sheets get `padding-bottom: env(safe-area-inset-bottom)`. Scroll containers reserve home-indicator clearance via `padding-bottom: max(16px, env(safe-area-inset-bottom))`. The therapist `.shell` + `.main-content` split is the reference: outer fixed `100dvh` + `overflow: clip`, inner `flex: 1` + `overflow-y: auto`. Patient surfaces should mirror it — body has `overflow: hidden` globally, so every full-viewport screen MUST own its own scroll container.
- **Scroll surfaces bounce.** Apply `.scroll-bounce` to any non-`.page` scroll container (sheet bodies, patient shell scroll region, full-viewport claim screens). The class wires `overflow-y: auto` + `-webkit-overflow-scrolling: touch` + `overscroll-behavior-y: contain` AND adds the `::after` rubber-band sentinel (`position: absolute; top: calc(100% + 1px)`) so even content shorter than the viewport gets the iOS elastic give. The therapist `.page` class has the same trick built in. Without it, scroll surfaces feel stiff on iOS — that's a tell that an outsider built the screen.
- **Dark mode is automatic IF you use tokens.** `dark.css` only redefines the `--*` variables on `html[data-theme="dark"]` (and via `prefers-color-scheme: dark` for unset). Anything that reads `var(--white)`, `var(--charcoal)`, `var(--border-lt)`, `var(--shadow-lg)`, etc. flips correctly with zero per-component work. Inline `rgba(...)` shadows / hex literals / hand-tuned alphas DON'T flip and end up as muddy black-on-black or invisible. **Always reach for the `--shadow-*` tokens, never `0 8px 32px rgba(0,0,0,0.06)` literals.**
- **Tabular numerals everywhere money is shown.** `font-variant-numeric: tabular-nums` on KPI cards, balance rows, payment amounts, session counters. Without it, numbers visually "dance" between renders and the financial copy looks sloppy.
- **Drawing outside these lines.** If a screen genuinely needs a new pattern (a chart, a calendar grid, a media-rich surface), ship it — but bring it up in `components.css` or a screen-scoped CSS file as a named class so the next person sees it as a deliberate addition, not a one-off inline-style snowflake. The codebase has zero TypeScript and zero UI library; the styles ARE the design system, and they only stay coherent if you keep adding to them in the same vocabulary.
- **Conventional commits** (`feat:`, `fix:`, `refactor:`, `style:`, `chore:`).
- **Don't deploy on every commit** — Vercel free tier caps at 100 deploys/day (resets midnight UTC). More importantly, every push to `main` that touches app code also fires an iOS→TestFlight build, and Apple throttles TestFlight uploads to a daily per-app limit (error 90382). Batch changes and push to `main` only when you actually want a build/deploy — see "iOS → TestFlight builds" under Ops.
- When adding or changing a session status / payment method / patient lifecycle value, update `data/constants.js` AND the DB check constraint in `supabase/schema.sql` (plus a migration).
- **Profession enum** (`PROFESSION` in `data/constants.js`) is mirrored in three other places that must stay in sync: the `user_profiles.profession` check constraint in `supabase/schema.sql` / migration `021_user_profiles.sql`, the `ALLOWED` set in `api/admin-update-profession.js`, and the keys in `src/i18n/vocabulary.js`. Adding a profession requires touching all four. Profession is locked at sign-up (chosen via `src/screens/ProfessionOnboarding.jsx`); only admin can change it afterwards via `AdminPanel`. The active profession flows through `CardiganContext` (`useCardigan().profession`) and is also pushed into `I18nProvider` so `t("…{client.s}…")`-style placeholders resolve to the right vocabulary (`src/i18n/vocabulary.js`).
