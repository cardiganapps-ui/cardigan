# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Cardigan

Mobile-first PWA for therapists to manage patients, sessions, payments, notes, and documents. All UI text is Spanish. No TypeScript — plain JS/JSX.

## Tech Stack
- **Frontend:** React 19 + Vite 5, custom CSS with design tokens (no UI library)
- **Backend:** Supabase (PostgreSQL + Auth + RLS) for data; Cloudflare R2 (via AWS S3 SDK) for document storage
- **Serverless:** Vercel functions under `api/` for admin ops, R2 presigned URLs, and web-push reminders
- **PWA:** `vite-plugin-pwa` with `injectManifest` strategy, custom `src/sw.js`
- **Hosting:** Vercel, auto-deploys from `main`. Live at https://cardigan-fawn.vercel.app

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

The `bugs` script and any `api/` function require `.env.local` with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus R2 and VAPID keys for document/push work.

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
- **Dates are stored as `"D MMM"` strings** (Spanish months: `"8 Abr"`) in `sessions.date` and `payments.date`. Convert with `utils/dates.js` (`formatShortDate`, `shortDateToISO`, `isoToShortDate`). Date inputs use ISO; display uses short form.
- **Auto-complete is display-only.** Past `scheduled` sessions render as `completed` but are NOT persisted. Users can override any session's status to any other (including reverting to scheduled). See `SESSION_STATUS` in `data/constants.js` — the DB check constraint mirrors this and must stay in sync.
- **Tutor sessions** (for minor patients) are marked by a `"T·"` prefix on `sessions.initials`. Helpers in `utils/sessions.js`. Purple styling is derived from this prefix.
- **Schedule/rate changes** take an effective date, delete future sessions, and regenerate at the new rate.
- **Duplicate patient names are rejected** at creation.

### Database & security
- `supabase/schema.sql` is the canonical schema; incremental changes go in numbered files under `supabase/migrations/`. Keep the `sessions.status` check constraint in sync with `SESSION_STATUS` and keep `ADMIN_EMAIL` (`data/constants.js`) in sync with the `is_admin()` function in `schema.sql`.
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

## Conventions
- **Spanish** for all user-visible text (use `useT()` from `src/i18n`).
- **Currency MXN**, formatted with `.toLocaleString()`.
- **Inline styles** for component-one-offs; reach for `src/styles/*.css` when a class is reused.
- **Conventional commits** (`feat:`, `fix:`, `refactor:`, `style:`, `chore:`).
- **Don't deploy on every commit** — Vercel free tier caps at 100 deploys/day (resets midnight UTC). Batch changes and push when asked.
- When adding or changing a session status / payment method / patient lifecycle value, update `data/constants.js` AND the DB check constraint in `supabase/schema.sql` (plus a migration).
